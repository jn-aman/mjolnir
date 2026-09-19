import { Router } from 'express';
import { PROVIDERS, enforcementNote, offeredProviders, providerStartUrl, type ProviderId } from '@mjolnir/account';
import { ENDPOINTS } from '@mjolnir/endpoints';
import type { AccountStore } from '../account.ts';
import { handle, HttpError } from '../http.ts';

/**
 * The account, as the UI sees it.
 *
 * Sign-in is two calls rather than one: `begin` returns the code to show
 * immediately, and `complete` is the long poll that resolves when the person
 * approves in their browser. Doing it in one call would mean a request hanging
 * for up to fifteen minutes with nothing on screen, which is
 * indistinguishable from the app having frozen.
 *
 * Every route here answers even when the licence service is unreachable,
 * because the settings page has to be able to say "cannot reach it" rather
 * than spin.
 */
export function accountRoutes(account: AccountStore): Router {
  const router = Router();

  router.get('/', handle(async (_req, res) => res.json(await account.status())));

  router.post(
    '/sign-in',
    handle(async (req, res) => {
      const body = (req.body ?? {}) as { provider?: unknown; emailHint?: unknown };
      const provider = typeof body.provider === 'string' && (PROVIDERS as readonly string[]).includes(body.provider) ? (body.provider as ProviderId) : undefined;
      const emailHint = typeof body.emailHint === 'string' && body.emailHint.includes('@') ? body.emailHint : undefined;
      try {
        const code = await account.beginSignIn({ ...(provider ? { provider } : {}), ...(emailHint ? { emailHint } : {}) });
        res.json({
          userCode: code.user_code,
          verificationUri: code.verification_uri,
          verificationUriComplete: code.verification_uri_complete ?? `${code.verification_uri}?code=${encodeURIComponent(code.user_code)}`,
          expiresIn: code.expires_in,
          interval: code.interval,
          providers: offeredProviders(code.providers).map((entry) => ({
            id: entry.id,
            label: entry.label,
            detail: entry.detail,
            enterprise: entry.enterprise,
            // Where the button goes. Present for everything but email, which
            // has nowhere to send a browser other than the code page.
            startUri: providerStartUrl(code.providers, entry.id),
          })),
          enforcement: enforcementNote(code.providers),
        });
      } catch (error) {
        throw new HttpError(502, 'upstream', error instanceof Error ? error.message : String(error));
      }
    }),
  );

  /** Resolves when the person approves, refuses, or the code expires. */
  router.post(
    '/sign-in/wait',
    handle(async (_req, res) => {
      const result = await account.completeSignIn();
      res.json({ ok: result.ok, failure: result.failure ?? null, status: result.status });
    }),
  );

  router.post(
    '/sign-in/cancel',
    handle(async (_req, res) => {
      account.cancelSignIn();
      res.json(await account.status());
    }),
  );

  router.post('/sign-out', handle(async (_req, res) => res.json(await account.signOut())));

  /** The machines on this account, and which of them hold a seat. */
  router.get('/devices', handle(async (_req, res) => res.json({ devices: await account.devices() })));

  router.post(
    '/devices/:id/revoke',
    handle(async (req, res) => {
      const id = String(req.params.id ?? '');
      if (!id) throw HttpError.badRequest('which device?');
      res.json(await account.revokeDevice(id));
    }),
  );

  /** Ask for a lease now, for the "check again" button. */
  router.post('/refresh', handle(async (_req, res) => res.json(await account.renew(true))));

  /**
   * Where to send someone to manage their billing.
   *
   * The app never renders a card form. Paddle is the merchant of record and
   * owns that screen; this is just the door.
   */
  router.get('/billing', handle(async (_req, res) => {
    const status = await account.status();
    res.json({
      url: `${ENDPOINTS.site}/account`,
      signedIn: status.signedIn,
      email: status.email,
    });
  }));

  return router;
}
