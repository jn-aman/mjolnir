import { createHash, randomBytes } from 'node:crypto';
import { Router } from 'express';
import { logger } from '@mjolnir/logger';
import type { Organisation, Store } from '../db.ts';
import { emailCode, newId } from '../signing.ts';
import { resolveIdentity } from '../identity.ts';
import { isOAuthProvider, OAuth, OAuthError, pkce, type OAuthProvider } from '../auth/oauth.ts';
import { errorPage, successPage } from '../auth/page.ts';

const log = logger.child('auth');

/** Ten minutes to read an email and type six digits. */
const CODE_LIFETIME_SECONDS = 600;

/**
 * Five minutes to get through a provider and back.
 *
 * Shorter than the device grant on purpose. The grant is a person walking to
 * another machine; this is a browser already mid-redirect, and a state that
 * outlives that trip is a state sitting around waiting to be replayed.
 */
const STATE_LIFETIME_SECONDS = 300;

/**
 * Proving who you are, so a device grant can be approved.
 *
 * Email is a one-time code rather than a password: no reset flow, nothing to
 * stuff, nothing worth stealing from the table. GitHub, Google and Okta are
 * ordinary OAuth from the browser and land at `/oauth/:provider/callback`,
 * which does the same thing the email path does at the end, namely find or
 * make the account and approve the waiting grant.
 *
 * The response never says whether an address is known. "We sent a code" for
 * an address with no account is how you avoid turning sign-in into a way to
 * enumerate customers.
 */
export function authRoutes(store: Store, sendEmail?: (to: string, code: string) => Promise<void>, oauth?: OAuth): Router {
  const router = Router();

  router.post('/email/start', async (req, res) => {
    const email = String(((req.body ?? {}) as Record<string, unknown>)['email'] ?? '').trim();
    if (!email.includes('@') || email.length > 200) {
      res.status(400).json({ error: 'invalid_request', error_description: 'that is not an email address' });
      return;
    }

    // An organisation that enforces its own sign-in must not be able to route
    // around it with an email code.
    const organisation = store.organisationForEmail(email);
    if (organisation?.enforceSso) {
      res.status(409).json({
        error: 'sso_required',
        error_description: `${organisation.name} requires everyone to sign in through their identity provider.`,
      });
      return;
    }

    const { code, hash } = emailCode();
    store.saveEmailCode(email, hash, Math.floor(Date.now() / 1000) + CODE_LIFETIME_SECONDS);
    if (sendEmail) await sendEmail(email, code);
    else log.warn('no email sender configured; the code is in this log', { email, code });

    res.json({ ok: true, expiresIn: CODE_LIFETIME_SECONDS });
  });

  router.post('/email/verify', (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const email = String(body['email'] ?? '').trim();
    const code = String(body['code'] ?? '').trim();
    const result = store.claimEmailCode(email, createHash('sha256').update(code).digest('hex'));
    if (result !== 'ok') {
      const description =
        result === 'expired'
          ? 'That code has expired. Ask for another.'
          : result === 'too-many'
            ? 'Too many attempts. Ask for a new code.'
            : 'That code is not right.';
      res.status(400).json({ error: result, error_description: description });
      return;
    }

    const account = store.upsertAccount(email, () => newId('acc'));
    log.info('email sign-in', { account: account.id });
    res.json({ accountId: account.id, email: account.email });
  });

  /** What this deployment can actually offer, so the site renders live buttons. */
  router.get('/providers', (_req, res) => {
    res.json({ available: ['email', ...(oauth?.available() ?? [])] });
  });

  // ---- oauth ------------------------------------------------------------

  /**
   * The start of a browser sign-in.
   *
   * It takes the user code of a waiting device grant, because a sign-in that
   * is not attached to a grant has nothing to approve at the end. Binding the
   * two here, and again through the state row, is what stops a callback from
   * approving somebody else's pending device.
   */
  router.get('/oauth/:provider/start', async (req, res) => {
    const provider = String(req.params['provider'] ?? '');
    if (!oauth || !isOAuthProvider(provider)) {
      res.status(404).type('html').send(errorPage({ title: 'Not available', detail: 'That sign-in method does not exist here.' }));
      return;
    }

    const userCode = String(req.query['user_code'] ?? '').trim().toUpperCase();
    const grant = userCode ? store.grantByUserCode(userCode) : null;
    if (!grant || grant.expiresAt < Math.floor(Date.now() / 1000)) {
      res.status(404).type('html').send(
        errorPage({
          title: 'That code has expired',
          detail: 'The sign-in it belonged to is no longer waiting.',
          hint: 'Start again from Mjolnir and you will get a fresh code.',
        }),
      );
      return;
    }
    if (grant.status !== 'pending') {
      res.status(409).type('html').send(
        errorPage({ title: 'Already answered', detail: 'This sign-in has already been approved or refused.' }),
      );
      return;
    }

    // The hint can come from the app, which knows the address someone typed,
    // or from this page, which is where an Okta user says which company they
    // are. Either way it only ever chooses the tenant and offers a default:
    // the provider decides who they are.
    const hint = String(req.query['email'] ?? grant.loginHint ?? '').trim() || null;
    let organisation: Organisation | undefined;
    if (provider === 'okta') {
      const byId = String(req.query['org'] ?? '').trim();
      organisation = (byId ? store.organisationById(byId) : null) ?? (hint ? store.organisationForEmail(hint) : null) ?? undefined;
      if (!organisation) {
        res.status(400).type('html').send(
          errorPage({
            title: 'We need your work address',
            detail: 'Single sign-on is set up per company, and we cannot tell which one to send you to.',
            hint: 'Enter your work email in Mjolnir before choosing Okta, and we will route you to the right tenant.',
          }),
        );
        return;
      }
    } else {
      // Refuse before the round trip rather than after it. Telling someone
      // their company requires Okta is far kinder on the way out than on the
      // way back from GitHub.
      const enforcing = hint ? store.organisationForEmail(hint) : null;
      if (enforcing?.enforceSso) {
        res.status(409).type('html').send(
          errorPage({
            title: 'Your company signs you in',
            detail: `${enforcing.name} requires everyone on that domain to use their identity provider.`,
            hint: 'Choose the single sign-on option in Mjolnir instead.',
          }),
        );
        return;
      }
    }

    try {
      const { verifier, challenge } = pkce();
      const state = randomBytes(24).toString('base64url');
      store.saveOAuthState({
        state,
        provider,
        userCode: grant.userCode,
        verifier,
        organisationId: organisation?.id ?? null,
        expiresAt: Math.floor(Date.now() / 1000) + STATE_LIFETIME_SECONDS,
      });
      const url = await oauth.authorizeUrl({ provider, state, challenge, organisation, loginHint: hint });
      log.info('oauth started', { provider, device: grant.deviceId });
      res.redirect(302, url);
    } catch (error) {
      res.status(400).type('html').send(pageFor(error));
    }
  });

  /**
   * The end of it.
   *
   * Everything that decides the outcome is read from our own state row and
   * from a server-to-server exchange. The browser contributes a code and a
   * state and is believed about nothing else.
   */
  router.get('/oauth/:provider/callback', async (req, res) => {
    const provider = String(req.params['provider'] ?? '');
    if (!oauth || !isOAuthProvider(provider)) {
      res.status(404).type('html').send(errorPage({ title: 'Not available', detail: 'That sign-in method does not exist here.' }));
      return;
    }

    // A provider that refused says so here, and it is usually the person
    // clicking cancel rather than anything wrong.
    const refused = typeof req.query['error'] === 'string' ? req.query['error'] : '';
    if (refused) {
      const detail = typeof req.query['error_description'] === 'string' ? req.query['error_description'] : refused;
      res.status(400).type('html').send(errorPage({ title: 'Sign-in was not completed', detail }));
      return;
    }

    const state = store.claimOAuthState(String(req.query['state'] ?? ''));
    const code = String(req.query['code'] ?? '');
    if (!state || state.provider !== provider || !code) {
      res.status(400).type('html').send(
        errorPage({
          title: 'That sign-in has expired',
          detail: 'It took too long, or this link has already been used.',
          hint: 'Start again from Mjolnir.',
        }),
      );
      return;
    }

    const grant = store.grantByUserCode(state.userCode);
    if (!grant || grant.expiresAt < Math.floor(Date.now() / 1000)) {
      res.status(404).type('html').send(
        errorPage({ title: 'The app stopped waiting', detail: 'The sign-in this belonged to has expired.', hint: 'Start again from Mjolnir.' }),
      );
      return;
    }

    const organisation = state.organisationId ? (store.organisationById(state.organisationId) ?? undefined) : undefined;

    try {
      const claim = await oauth.claim({ provider, code, verifier: state.verifier, organisation });

      /*
       * An organisation's identity provider vouches for that organisation.
       *
       * Without this check, anyone who can configure an Okta tenant could
       * have it assert `someone@another-company.com` and walk into their
       * account. The tenant is only ever allowed to speak for the domains
       * that organisation has actually proved it owns.
       */
      if (provider === 'okta' && organisation) {
        const domain = claim.email.split('@')[1]?.toLowerCase() ?? '';
        const owned = store.verifiedDomains(organisation.id).map((entry) => entry.toLowerCase());
        if (!domain || !owned.includes(domain)) {
          log.warn('an identity provider vouched for a domain it does not own', { organisation: organisation.id, domain });
          res.status(403).type('html').send(
            errorPage({
              title: 'That address is not covered',
              detail: `${organisation.name} has not verified the domain on ${claim.email || 'that address'}.`,
              hint: 'Ask whoever administers your Mjolnir organisation to add and verify the domain.',
            }),
          );
          return;
        }
      }

      const outcome = resolveIdentity(store, claim);
      if (!outcome.ok) {
        res.status(outcome.error === 'sso_required' ? 409 : 403).type('html').send(
          errorPage({
            title: outcome.error === 'sso_required' ? 'Your company signs you in' : 'That address is not confirmed',
            detail: outcome.description,
          }),
        );
        return;
      }

      // The grant records the provider that was actually used, not the one
      // the app guessed, so the settings page names the right door.
      store.saveGrant({ ...grant, accountId: outcome.account.id, status: 'approved', provider });
      log.info('oauth sign-in approved', {
        provider,
        account: outcome.account.id,
        created: outcome.created,
        linked: outcome.linked,
      });

      res.type('html').send(successPage({ email: outcome.account.email, provider, deviceName: grant.deviceName }));
    } catch (error) {
      log.warn('oauth callback failed', { provider, error: error instanceof Error ? error.message : String(error) });
      res.status(400).type('html').send(pageFor(error));
    }
  });

  return router;
}

/** Provider failures already read as sentences; anything else must not leak. */
function pageFor(error: unknown): string {
  if (error instanceof OAuthError) return errorPage({ title: 'Sign-in did not work', detail: error.message });
  return errorPage({
    title: 'Something went wrong',
    detail: 'We could not finish that sign-in.',
    hint: 'Try again, and if it keeps happening tell us at support@mjolnir.sh.',
  });
}

export type { OAuthProvider };
