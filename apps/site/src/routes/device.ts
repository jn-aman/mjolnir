import { Router } from 'express';
import { logger } from '@mjolnir/logger';
import type { Store } from '../db.ts';
import { deviceCode, hashToken, newId, refreshToken, userCode } from '../signing.ts';

const log = logger.child('device-grant');

/** Fifteen minutes to type eight characters is generous and still bounded. */
const CODE_LIFETIME_SECONDS = 900;
const POLL_INTERVAL_SECONDS = 5;

/**
 * The device authorization grant, server side.
 *
 * Two endpoints and one rule: the app never learns anything until the person
 * has approved in a browser. Everything before that point is a pending row
 * with no account attached.
 */
export function deviceRoutes(store: Store, options: { verificationUri: string }): Router {
  const router = Router();

  router.post('/code', (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const deviceId = String(body['device_id'] ?? '').trim();
    if (deviceId.length < 8) {
      res.status(400).json({ error: 'invalid_request', error_description: 'device_id is required' });
      return;
    }

    const loginHint = typeof body['login_hint'] === 'string' ? body['login_hint'] : null;
    const organisation = loginHint ? store.organisationForEmail(loginHint) : null;

    const grant = {
      deviceCode: deviceCode(),
      userCode: userCode(),
      deviceId,
      deviceName: String(body['device_name'] ?? 'A machine').slice(0, 80),
      platform: String(body['platform'] ?? 'unknown').slice(0, 20),
      appVersion: String(body['app_version'] ?? '0').slice(0, 20),
      provider: typeof body['provider'] === 'string' ? body['provider'] : null,
      loginHint,
      expiresAt: Math.floor(Date.now() / 1000) + CODE_LIFETIME_SECONDS,
      interval: POLL_INTERVAL_SECONDS,
      accountId: null,
      status: 'pending' as const,
      lastPolledAt: 0,
    };
    store.saveGrant(grant);

    // What this person may use. An organisation that enforces Okta gets one
    // button, because showing a GitHub button to someone who must not use it
    // produces a second identity for the same human and a support ticket.
    const enforced = organisation?.enforceSso ? 'okta' : null;
    const available = enforced ? ['okta'] : ['email', 'github', 'google', ...(organisation ? ['okta'] : [])];

    res.json({
      device_code: grant.deviceCode,
      user_code: grant.userCode,
      verification_uri: options.verificationUri,
      verification_uri_complete: `${options.verificationUri}?code=${encodeURIComponent(grant.userCode)}`,
      expires_in: CODE_LIFETIME_SECONDS,
      interval: POLL_INTERVAL_SECONDS,
      providers: { available, enforced, enforcedBy: enforced ? (organisation?.name ?? null) : null },
    });
  });

  router.post('/token', (req, res) => {
    const code = String(((req.body ?? {}) as Record<string, unknown>)['device_code'] ?? '');
    const grant = store.grantByDeviceCode(code);
    const now = Math.floor(Date.now() / 1000);

    if (!grant) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'this sign-in is not one we started' });
      return;
    }
    if (grant.expiresAt < now) {
      store.deleteGrant(code);
      res.status(400).json({ error: 'expired_token', error_description: 'the code expired before it was approved' });
      return;
    }
    // The RFC's own answer to a client polling faster than it was told to.
    // Answering normally would reward it.
    if (now - grant.lastPolledAt < grant.interval - 1) {
      store.saveGrant({ ...grant, lastPolledAt: now });
      res.status(400).json({ error: 'slow_down', error_description: 'polling faster than the interval' });
      return;
    }
    store.saveGrant({ ...grant, lastPolledAt: now });

    if (grant.status === 'denied') {
      store.deleteGrant(code);
      res.status(400).json({ error: 'access_denied', error_description: 'the sign-in was refused' });
      return;
    }
    if (grant.status !== 'approved' || !grant.accountId) {
      res.status(400).json({ error: 'authorization_pending', error_description: 'waiting for approval' });
      return;
    }

    const account = store.accountById(grant.accountId);
    if (!account) {
      store.deleteGrant(code);
      res.status(400).json({ error: 'invalid_grant', error_description: 'that account no longer exists' });
      return;
    }

    // The code is spent the moment it works. A device code that can be
    // exchanged twice is a device code that can be replayed.
    store.deleteGrant(code);

    const token = refreshToken();
    const existing = store.devicesFor(account.id).find((entry) => entry.id === grant.deviceId);
    store.saveDevice({
      id: grant.deviceId,
      accountId: account.id,
      name: grant.deviceName,
      platform: grant.platform,
      appVersion: grant.appVersion,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      refreshTokenHash: token.hash,
      revokedAt: null,
    });

    log.info('device signed in', { account: account.id, provider: grant.provider ?? 'email' });
    res.json({
      refresh_token: token.token,
      access_token: newId('at'),
      expires_in: 900,
      email: account.email,
      identity: {
        provider: grant.provider ?? 'email',
        email: account.email,
        ...(account.organisationId ? { organisation: account.organisationId } : {}),
      },
    });
  });

  /**
   * The browser side: look up a code someone typed.
   *
   * Deliberately says nothing about the device beyond its name, so a guessed
   * code does not reveal who it belongs to before anyone has authenticated.
   */
  router.get('/verify/:code', (req, res) => {
    const grant = store.grantByUserCode(String(req.params.code ?? ''));
    if (!grant || grant.expiresAt < Math.floor(Date.now() / 1000)) {
      res.status(404).json({ error: 'not_found', error_description: 'that code is not valid, or it has expired' });
      return;
    }
    res.json({ deviceName: grant.deviceName, platform: grant.platform, appVersion: grant.appVersion, status: grant.status });
  });

  /** The browser side: approve, once the person has proved who they are. */
  router.post('/approve', (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const grant = store.grantByUserCode(String(body['user_code'] ?? ''));
    const accountId = String(body['account_id'] ?? '');
    if (!grant || grant.expiresAt < Math.floor(Date.now() / 1000)) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    if (!store.accountById(accountId)) {
      res.status(400).json({ error: 'invalid_request' });
      return;
    }
    store.saveGrant({ ...grant, accountId, status: 'approved' });
    res.json({ ok: true });
  });

  router.post('/deny', (req, res) => {
    const grant = store.grantByUserCode(String(((req.body ?? {}) as Record<string, unknown>)['user_code'] ?? ''));
    if (grant) store.saveGrant({ ...grant, status: 'denied' });
    res.json({ ok: true });
  });

  return router;
}

export { hashToken };
