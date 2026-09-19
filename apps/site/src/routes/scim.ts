import { Router, type Request, type Response } from 'express';
import { logger } from '@mjolnir/logger';
import type { Organisation, ScimUser, Store } from '../db.ts';
import { hashToken, newId } from '../signing.ts';

const log = logger.child('scim');

/**
 * SCIM 2.0, so an organisation's directory owns who has a seat.
 *
 * Provisioning is the convenience. **Deprovisioning is the reason this gets
 * bought.** "We removed them in Okta three weeks ago and they still have a
 * licence" is not a support ticket, it is a finding in someone's audit, and it
 * is the question every security review asks before an enterprise deal closes.
 *
 * So the important line in this file is short: setting `active` to false
 * revokes every device on that account immediately, which frees the seat
 * immediately, and `issueLease` then refuses to give them another one. The
 * lease already on their laptop keeps working until it expires, because it is
 * signed and we cannot reach into it. That week is the revocation window, it
 * is stated in the docs, and it is why the window is a week rather than a
 * month.
 *
 * Only the User resource is implemented. Groups map to plans, plans are not
 * per-group yet, and a Groups endpoint that accepts writes and does nothing
 * with them is worse than a 501 that says so.
 */

const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
const LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';
const PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';

/** SCIM has its own media type and clients do check for it. */
const SCIM_TYPE = 'application/scim+json; charset=utf-8';

interface ScimBody {
  readonly userName?: unknown;
  readonly externalId?: unknown;
  readonly displayName?: unknown;
  readonly active?: unknown;
  readonly name?: { givenName?: unknown; familyName?: unknown } | undefined;
  readonly emails?: unknown;
  readonly Operations?: unknown;
  readonly schemas?: unknown;
}

export function scimRoutes(store: Store, options: { publicUrl?: string } = {}): Router {
  const router = Router();

  // SCIM bodies arrive as `application/scim+json`, which the ordinary JSON
  // parser mounted on the app will not touch.
  router.use((req, _res, next) => {
    if (req.is('application/scim+json') || req.is('json')) return next();
    next();
  });

  /** Every route needs the organisation whose token this is. */
  const tenant = (req: Request, res: Response): Organisation | null => {
    const header = req.get('authorization') ?? '';
    const token = header.replace(/^Bearer\s+/i, '').trim();
    const organisation = token ? store.organisationByScimToken(hashToken(token)) : null;
    if (!organisation) {
      // 401 with a WWW-Authenticate header, because SCIM clients use it to
      // tell "your token is wrong" from "your URL is wrong", and Okta shows
      // the difference to whoever is configuring it.
      res.set('www-authenticate', 'Bearer realm="mjolnir"');
      fail(res, 401, 'Authentication failed.');
      return null;
    }
    return organisation;
  };

  // ---- discovery --------------------------------------------------------

  /*
   * Okta reads these three before it will finish setting up an integration,
   * and answers 404 to any of them read as "this is not a SCIM server".
   */
  router.get('/ServiceProviderConfig', (_req, res) => {
    send(res, 200, {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
      documentationUri: 'https://mjolnir.sh/docs/scim',
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: 200 },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [
        {
          type: 'oauthbearertoken',
          name: 'OAuth Bearer Token',
          description: 'A bearer token issued to this organisation.',
          primary: true,
        },
      ],
    });
  });

  router.get('/ResourceTypes', (_req, res) => {
    const base = (options.publicUrl ?? '').replace(/\/+$/, '');
    send(res, 200, {
      schemas: [LIST_SCHEMA],
      totalResults: 1,
      itemsPerPage: 1,
      startIndex: 1,
      Resources: [
        {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
          id: 'User',
          name: 'User',
          endpoint: '/Users',
          description: 'A person who may hold a seat.',
          schema: USER_SCHEMA,
          meta: { resourceType: 'ResourceType', location: `${base}/scim/v2/ResourceTypes/User` },
        },
      ],
    });
  });

  router.get('/Schemas', (_req, res) => {
    send(res, 200, {
      schemas: [LIST_SCHEMA],
      totalResults: 1,
      itemsPerPage: 1,
      startIndex: 1,
      Resources: [
        {
          id: USER_SCHEMA,
          name: 'User',
          description: 'A person who may hold a Mjolnir seat.',
          attributes: [
            attribute('userName', 'string', { required: true, uniqueness: 'server' }),
            attribute('displayName', 'string', {}),
            attribute('active', 'boolean', {}),
            attribute('externalId', 'string', {}),
          ],
          meta: { resourceType: 'Schema' },
        },
      ],
    });
  });

  // ---- users ------------------------------------------------------------

  router.get('/Users', (req, res) => {
    const organisation = tenant(req, res);
    if (!organisation) return;

    const filter = typeof req.query['filter'] === 'string' ? req.query['filter'] : '';
    const parsed = parseFilter(filter);
    if (parsed === 'unsupported') {
      fail(res, 400, `We can only filter on userName or externalId with eq. We were sent: ${filter}`, 'invalidFilter');
      return;
    }

    const page = store.scimUsers(organisation.id, {
      ...(parsed?.attribute === 'userName' ? { userName: parsed.value } : {}),
      ...(parsed?.attribute === 'externalId' ? { externalId: parsed.value } : {}),
      startIndex: Number(req.query['startIndex'] ?? 1) || 1,
      count: req.query['count'] === undefined ? 100 : Number(req.query['count']),
    });

    send(res, 200, {
      schemas: [LIST_SCHEMA],
      totalResults: page.total,
      itemsPerPage: page.items.length,
      startIndex: Math.max(1, Number(req.query['startIndex'] ?? 1) || 1),
      Resources: page.items.map((user) => represent(user, options.publicUrl)),
    });
  });

  router.get('/Users/:id', (req, res) => {
    const organisation = tenant(req, res);
    if (!organisation) return;
    const user = store.scimUser(organisation.id, String(req.params['id'] ?? ''));
    if (!user) {
      fail(res, 404, 'No such user.');
      return;
    }
    send(res, 200, represent(user, options.publicUrl));
  });

  /**
   * Provisioning.
   *
   * The account is created if it does not exist, because the directory is
   * authoritative about who works there and we should not make someone sign in
   * once before their admin can give them a seat.
   *
   * The domain is checked against the organisation's verified domains for the
   * same reason the Okta callback checks it: a directory may only speak for
   * the domains its organisation has proved it owns.
   */
  router.post('/Users', (req, res) => {
    const organisation = tenant(req, res);
    if (!organisation) return;

    const body = (req.body ?? {}) as ScimBody;
    const userName = readUserName(body);
    if (!userName) {
      fail(res, 400, 'userName is required and must be an email address.', 'invalidValue');
      return;
    }
    if (!ownsDomain(store, organisation, userName)) {
      fail(res, 400, `${organisation.name} has not verified the domain on ${userName}.`, 'invalidValue');
      return;
    }

    const already = store.scimUserByName(organisation.id, userName);
    if (already) {
      // 409 with `uniqueness`, which is what tells Okta to stop retrying and
      // reconcile against the existing record instead of looping.
      fail(res, 409, 'That user already exists.', 'uniqueness');
      return;
    }

    const account = store.upsertAccount(userName, () => newId('acc'));
    const now = new Date().toISOString();
    const user: ScimUser = {
      id: newId('scm'),
      organisationId: organisation.id,
      accountId: account.id,
      userName,
      externalId: typeof body.externalId === 'string' ? body.externalId : null,
      displayName: readDisplayName(body),
      active: body.active === undefined ? true : body.active === true || body.active === 'true',
      createdAt: now,
      updatedAt: now,
    };
    store.saveScimUser(user);
    applyActivation(store, user);
    log.info('scim user provisioned', { organisation: organisation.id, account: account.id, active: user.active });
    send(res, 201, represent(user, options.publicUrl));
  });

  /** Replace. Okta uses this for profile pushes and for the deactivate toggle. */
  router.put('/Users/:id', (req, res) => {
    const organisation = tenant(req, res);
    if (!organisation) return;
    const existing = store.scimUser(organisation.id, String(req.params['id'] ?? ''));
    if (!existing) {
      fail(res, 404, 'No such user.');
      return;
    }

    const body = (req.body ?? {}) as ScimBody;
    const userName = readUserName(body) ?? existing.userName;
    if (userName !== existing.userName && !ownsDomain(store, organisation, userName)) {
      fail(res, 400, `${organisation.name} has not verified the domain on ${userName}.`, 'invalidValue');
      return;
    }

    const updated: ScimUser = {
      ...existing,
      userName,
      externalId: typeof body.externalId === 'string' ? body.externalId : existing.externalId,
      displayName: readDisplayName(body) ?? existing.displayName,
      active: body.active === undefined ? existing.active : body.active === true || body.active === 'true',
      updatedAt: new Date().toISOString(),
    };
    store.saveScimUser(updated);
    if (updated.active !== existing.active) applyActivation(store, updated);
    send(res, 200, represent(updated, options.publicUrl));
  });

  /**
   * Patch, which is how Okta actually deprovisions.
   *
   * It sends `{op: "replace", value: {active: false}}`, sometimes with a path
   * and sometimes without, and both spellings are legal. A server that handles
   * only the one with a path looks like it works right up until the day
   * somebody is offboarded.
   */
  router.patch('/Users/:id', (req, res) => {
    const organisation = tenant(req, res);
    if (!organisation) return;
    const existing = store.scimUser(organisation.id, String(req.params['id'] ?? ''));
    if (!existing) {
      fail(res, 404, 'No such user.');
      return;
    }

    const body = (req.body ?? {}) as ScimBody;
    const schemas = Array.isArray(body.schemas) ? (body.schemas as unknown[]).map(String) : [];
    if (schemas.length > 0 && !schemas.includes(PATCH_SCHEMA)) {
      fail(res, 400, 'A PATCH must use the PatchOp schema.', 'invalidValue');
      return;
    }
    const operations = Array.isArray(body.Operations) ? (body.Operations as Array<Record<string, unknown>>) : [];
    if (operations.length === 0) {
      fail(res, 400, 'A PATCH needs at least one operation.', 'invalidValue');
      return;
    }

    let next: ScimUser = existing;
    for (const operation of operations) {
      const op = String(operation['op'] ?? '').toLowerCase();
      if (op !== 'replace' && op !== 'add') {
        // `remove` on `active` is not a thing Okta sends, and guessing at what
        // removing an attribute should mean for a seat is how you free the
        // wrong one.
        fail(res, 400, `We do not support the "${op}" operation.`, 'invalidSyntax');
        return;
      }
      const path = typeof operation['path'] === 'string' ? operation['path'] : '';
      const value = operation['value'];
      const changes = path ? { [stripPath(path)]: value } : ((value ?? {}) as Record<string, unknown>);
      next = merge(next, changes);
    }

    if (next.userName !== existing.userName && !ownsDomain(store, organisation, next.userName)) {
      fail(res, 400, `${organisation.name} has not verified the domain on ${next.userName}.`, 'invalidValue');
      return;
    }

    next = { ...next, updatedAt: new Date().toISOString() };
    store.saveScimUser(next);
    if (next.active !== existing.active) {
      applyActivation(store, next);
      log.info(next.active ? 'scim user reactivated' : 'scim user deprovisioned', {
        organisation: organisation.id,
        account: next.accountId,
      });
    }
    send(res, 200, represent(next, options.publicUrl));
  });

  /**
   * Delete, which most directories send instead of a deactivate.
   *
   * The account survives. Somebody who leaves a company and comes back, or who
   * bought a personal licence with the same address, has not had their history
   * erased by an offboarding script. What goes is the seat and the sessions.
   */
  router.delete('/Users/:id', (req, res) => {
    const organisation = tenant(req, res);
    if (!organisation) return;
    const existing = store.scimUser(organisation.id, String(req.params['id'] ?? ''));
    if (!existing) {
      fail(res, 404, 'No such user.');
      return;
    }
    store.saveScimUser({ ...existing, active: false, updatedAt: new Date().toISOString() });
    applyActivation(store, { ...existing, active: false });
    store.deleteScimUser(organisation.id, existing.id);
    // The revocation has to outlive the row, or deleting a user would leave
    // them signed in with a seat and nothing recording that they should not be.
    store.suspendAccount(existing.accountId, true);
    log.info('scim user deleted', { organisation: organisation.id, account: existing.accountId });
    res.status(204).end();
  });

  router.all('/Groups{/*path}', (_req, res) => {
    fail(res, 501, 'Group provisioning is not implemented. Assign seats to users.');
  });

  return router;
}

/**
 * What a change to `active` actually does.
 *
 * Deactivating revokes every device on the account, which frees the seat the
 * same second rather than whenever the last lease happens to lapse, and marks
 * the account so `issueLease` will not hand out another one. Reactivating
 * lifts the mark; the person signs in again, as they would on a new machine.
 */
function applyActivation(store: Store, user: ScimUser): void {
  if (user.active) {
    store.suspendAccount(user.accountId, false);
    return;
  }
  const revoked = store.revokeAllDevices(user.accountId);
  store.suspendAccount(user.accountId, true);
  log.info('seat freed by the directory', { account: user.accountId, devices: revoked });
}

/** A directory speaks only for the domains its organisation has proved it owns. */
function ownsDomain(store: Store, organisation: Organisation, email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  return domain.length > 0 && store.verifiedDomains(organisation.id).some((entry) => entry.toLowerCase() === domain);
}

function readUserName(body: ScimBody): string | null {
  if (typeof body.userName === 'string' && body.userName.includes('@')) return body.userName.trim().toLowerCase();
  // Some directories put the address only in `emails`, so fall back to the
  // primary one rather than refusing a valid provisioning call.
  const emails = Array.isArray(body.emails) ? (body.emails as Array<Record<string, unknown>>) : [];
  const primary = emails.find((entry) => entry['primary'] === true) ?? emails[0];
  const value = primary?.['value'];
  return typeof value === 'string' && value.includes('@') ? value.trim().toLowerCase() : null;
}

function readDisplayName(body: ScimBody): string | null {
  if (typeof body.displayName === 'string') return body.displayName;
  const given = typeof body.name?.givenName === 'string' ? body.name.givenName : '';
  const family = typeof body.name?.familyName === 'string' ? body.name.familyName : '';
  const joined = `${given} ${family}`.trim();
  return joined || null;
}

/** `urn:...:User:active` and `active` mean the same thing. */
function stripPath(path: string): string {
  return path.split(':').pop() ?? path;
}

function merge(user: ScimUser, changes: Record<string, unknown>): ScimUser {
  let next = user;
  for (const [key, value] of Object.entries(changes)) {
    switch (key) {
      case 'active':
        next = { ...next, active: value === true || value === 'true' };
        break;
      case 'userName':
        if (typeof value === 'string' && value.includes('@')) next = { ...next, userName: value.trim().toLowerCase() };
        break;
      case 'externalId':
        next = { ...next, externalId: typeof value === 'string' ? value : null };
        break;
      case 'displayName':
        next = { ...next, displayName: typeof value === 'string' ? value : null };
        break;
      default:
        // Names, addresses, phone numbers, locale. We do not store them, and
        // failing a whole offboarding because a directory also sent a job
        // title would be the wrong trade every time.
        break;
    }
  }
  return next;
}

/** `userName eq "someone@acme.test"`, which is the only filter anyone sends. */
function parseFilter(filter: string): { attribute: 'userName' | 'externalId'; value: string } | null | 'unsupported' {
  const trimmed = filter.trim();
  if (!trimmed) return null;
  const match = /^(userName|externalId)\s+eq\s+"([^"]*)"$/i.exec(trimmed);
  if (!match) return 'unsupported';
  const attribute = match[1]?.toLowerCase() === 'username' ? 'userName' : 'externalId';
  return { attribute, value: match[2] ?? '' };
}

function represent(user: ScimUser, publicUrl?: string): Record<string, unknown> {
  const base = (publicUrl ?? '').replace(/\/+$/, '');
  return {
    schemas: [USER_SCHEMA],
    id: user.id,
    ...(user.externalId ? { externalId: user.externalId } : {}),
    userName: user.userName,
    ...(user.displayName ? { displayName: user.displayName } : {}),
    active: user.active,
    emails: [{ value: user.userName, primary: true, type: 'work' }],
    meta: {
      resourceType: 'User',
      created: user.createdAt,
      lastModified: user.updatedAt,
      location: `${base}/scim/v2/Users/${user.id}`,
    },
  };
}

function attribute(name: string, type: string, extra: Record<string, unknown>): Record<string, unknown> {
  return { name, type, multiValued: false, required: false, caseExact: false, mutability: 'readWrite', returned: 'default', ...extra };
}

function send(res: Response, status: number, body: unknown): void {
  res.status(status).type(SCIM_TYPE).send(JSON.stringify(body));
}

function fail(res: Response, status: number, detail: string, scimType?: string): void {
  send(res, status, { schemas: [ERROR_SCHEMA], status: String(status), detail, ...(scimType ? { scimType } : {}) });
}
