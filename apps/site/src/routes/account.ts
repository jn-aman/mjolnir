import { Router, type Request } from 'express';
import { logger } from '@mjolnir/logger';
import type { Account, Store } from '../db.ts';
import { claimsFor, issueLease, view } from '../licensing.ts';
import { hashToken, type Signer } from '../signing.ts';

const log = logger.child('account');

/**
 * Everything the app asks for after it has signed in.
 *
 * Authenticated by the refresh token rather than a separate access token: the
 * app makes a handful of calls a day, all of them from the same process that
 * holds the refresh token, and a second token type would be two things to
 * expire, store and get wrong for no gain at this size.
 *
 * Every route here re-reads the device and checks it is not revoked, so
 * signing a machine out takes effect on its next call rather than whenever
 * something happens to expire.
 */
export function accountRoutes(store: Store, signer: Signer): Router {
  const router = Router();

  const authenticate = (req: Request): { account: Account; deviceId: string } | null => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const header = req.get('authorization')?.replace(/^Bearer\s+/i, '');
    const token = String(body['refresh_token'] ?? header ?? '');
    if (!token) return null;
    const device = store.deviceByTokenHash(hashToken(token));
    if (!device) return null;
    const account = store.accountById(device.accountId);
    return account ? { account, deviceId: device.id } : null;
  };

  const unauthorised = (res: Parameters<Parameters<Router['post']>[1]>[1]) => {
    // 401 specifically, because the app treats it as "this device was signed
    // out" and asks the person to sign in again rather than retrying forever.
    res.status(401).json({ error: 'invalid_grant', error_description: 'this device is not signed in' });
  };

  router.post('/licence/lease', (req, res) => {
    const auth = authenticate(req);
    if (!auth) return unauthorised(res);

    const body = (req.body ?? {}) as Record<string, unknown>;
    const outcome = issueLease(store, signer, auth.account, {
      id: auth.deviceId,
      name: String(body['device_name'] ?? 'A machine').slice(0, 80),
      platform: String(body['platform'] ?? 'unknown').slice(0, 20),
      appVersion: String(body['app_version'] ?? '0').slice(0, 20),
    });

    if (!outcome.ok) {
      // A seat limit is a 409: the request was understood, the state refuses
      // it, and the body carries what to do about it.
      res.status(outcome.error === 'seat_limit' ? 409 : 402).json(outcome);
      return;
    }
    res.json(outcome);
  });

  router.post('/token/revoke', (req, res) => {
    const auth = authenticate(req);
    if (!auth) return unauthorised(res);
    store.revokeDevice(auth.account.id, auth.deviceId);
    log.info('device signed out', { account: auth.account.id });
    res.json({ ok: true });
  });

  router.post('/account', (req, res) => {
    const auth = authenticate(req);
    if (!auth) return unauthorised(res);
    const subscription = store.subscriptionFor(auth.account.id);
    const active = store.activeDevices(auth.account.id);
    res.json({
      email: auth.account.email,
      plan: subscription?.plan ?? null,
      status: subscription?.status ?? null,
      expiresAt: subscription?.expiresAt ?? null,
      seats: { total: subscription?.seats ?? 0, used: active.length },
      devices: view(store.devicesFor(auth.account.id), auth.deviceId, active),
    });
  });

  /**
   * Every machine this account has, and which of them hold a seat.
   *
   * The app shows this so "why can I not use Pro here" has an answer on the
   * screen where the question is asked, rather than in an email to support.
   */
  router.post('/account/devices', (req, res) => {
    const auth = authenticate(req);
    if (!auth) return unauthorised(res);
    const active = store.activeDevices(auth.account.id);
    const subscription = store.subscriptionFor(auth.account.id);
    res.json({
      seats: { total: subscription?.seats ?? 0, used: active.length },
      devices: view(store.devicesFor(auth.account.id), auth.deviceId, active),
    });
  });

  /** Signs another machine out, freeing its seat straight away. */
  router.post('/account/devices/revoke', (req, res) => {
    const auth = authenticate(req);
    if (!auth) return unauthorised(res);
    const target = String(((req.body ?? {}) as Record<string, unknown>)['device_id'] ?? '');
    if (!target) {
      res.status(400).json({ error: 'invalid_request', error_description: 'device_id is required' });
      return;
    }
    store.revokeDevice(auth.account.id, target);
    log.info('device revoked', { account: auth.account.id, self: target === auth.deviceId });
    const active = store.activeDevices(auth.account.id);
    const subscription = store.subscriptionFor(auth.account.id);
    res.json({
      ok: true,
      /** True when someone signed out the machine they are sitting at. */
      wasCurrent: target === auth.deviceId,
      seats: { total: subscription?.seats ?? 0, used: active.length },
      devices: view(store.devicesFor(auth.account.id), auth.deviceId, active),
    });
  });

  /**
   * A licence key with no expiry, for a lifetime purchase.
   *
   * Offered rather than hidden. Someone who paid once should not need this
   * service to exist in ten years, and saying so is the difference between a
   * lifetime licence and a subscription with a long first period.
   */
  router.post('/licence/perpetual', (req, res) => {
    const auth = authenticate(req);
    if (!auth) return unauthorised(res);
    const subscription = store.subscriptionFor(auth.account.id);
    if (!subscription || subscription.plan !== 'lifetime') {
      res.status(403).json({ error: 'not_lifetime', error_description: 'Perpetual keys are for lifetime licences.' });
      return;
    }
    res.json({ key: signer.signPerpetual(claimsFor(auth.account, subscription)) });
  });

  return router;
}
