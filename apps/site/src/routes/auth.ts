import { createHash } from 'node:crypto';
import { Router } from 'express';
import { logger } from '@mjolnir/logger';
import type { Store } from '../db.ts';
import { emailCode, newId } from '../signing.ts';

const log = logger.child('auth');

/** Ten minutes to read an email and type six digits. */
const CODE_LIFETIME_SECONDS = 600;

/**
 * Proving who you are, so a device grant can be approved.
 *
 * Email is a one-time code rather than a password: no reset flow, nothing to
 * stuff, nothing worth stealing from the table. GitHub, Google and Okta are
 * ordinary OAuth from the browser and land at `/callback`, which does the same
 * thing this does at the end, namely find or make the account and approve the
 * waiting grant.
 *
 * The response never says whether an address is known. "We sent a code" for
 * an address with no account is how you avoid turning sign-in into a way to
 * enumerate customers.
 */
export function authRoutes(store: Store, sendEmail?: (to: string, code: string) => Promise<void>): Router {
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

  return router;
}
