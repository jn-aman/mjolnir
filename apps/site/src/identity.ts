import { logger } from '@mjolnir/logger';
import type { Account, Store } from './db.ts';
import { newId } from './signing.ts';

const log = logger.child('identity');

/**
 * One human, however they sign in.
 *
 * The same person will use an email code today, GitHub tomorrow and their
 * company's Okta next month. All three have to land on one account, or they
 * get three accounts, three seats and three subscriptions, and the support
 * ticket reads "I paid and it says I have not".
 *
 * Linking by email is the obvious way to do that and it is also how accounts
 * get stolen, so the rules below are not optional.
 */

export interface ProviderClaim {
  readonly provider: 'email' | 'github' | 'google' | 'okta';
  /**
   * The provider's own stable id, never the email.
   *
   * GitHub usernames change and people leave companies. An account that
   * follows a changed email address is an account that can be taken over by
   * whoever is next given that address.
   */
  readonly subject: string;
  readonly email: string;
  /**
   * Whether the provider says it has verified this address.
   *
   * The single most important field here. GitHub will hand back an email a
   * user typed in and never confirmed; if an unverified address could link to
   * an existing account, anyone could set their GitHub email to a victim's
   * and sign in as them. An unverified address is treated as no address at
   * all.
   */
  readonly emailVerified: boolean;
  readonly handle?: string | undefined;
}

export type LinkOutcome =
  | { readonly ok: true; readonly account: Account; readonly created: boolean; readonly linked: boolean }
  | { readonly ok: false; readonly error: 'unverified_email'; readonly description: string }
  | { readonly ok: false; readonly error: 'sso_required'; readonly description: string; readonly organisation: string };

/**
 * Finds or creates the account for a sign-in, and links the identity to it.
 *
 * The order matters and each step is load bearing:
 *
 * 1. **Have we seen this exact identity before?** If so it is that account,
 *    whatever the email says today. This is what makes a changed email
 *    harmless rather than dangerous.
 * 2. **Is this domain claimed by an organisation that enforces SSO?** If so,
 *    and this is not that provider, refuse. Otherwise one employee arrives via
 *    GitHub and becomes a second person with a second seat.
 * 3. **Is the email verified?** If not, this identity gets its own account and
 *    links to nothing. It cannot reach an existing one.
 * 4. **Does an account with that email exist?** Then link to it: this is the
 *    same person arriving by a new door.
 * 5. Otherwise make one.
 */
export function resolveIdentity(store: Store, claim: ProviderClaim): LinkOutcome {
  const email = claim.email.trim().toLowerCase();

  const known = store.identityFor(claim.provider, claim.subject);
  if (known) {
    const account = store.accountById(known.accountId);
    if (account) {
      // Keep the recorded address current for support, without ever letting it
      // decide which account this is.
      if (email && email !== known.email) store.linkIdentity({ ...known, email });
      return { ok: true, account, created: false, linked: false };
    }
  }

  const organisation = email ? store.organisationForEmail(email) : null;
  if (organisation?.enforceSso && claim.provider !== 'okta') {
    return {
      ok: false,
      error: 'sso_required',
      description: `${organisation.name} requires everyone on ${email.split('@')[1]} to sign in through their identity provider.`,
      organisation: organisation.name,
    };
  }

  if (!email) {
    return { ok: false, error: 'unverified_email', description: `${claim.provider} did not give us an email address.` };
  }

  if (!claim.emailVerified) {
    // Deliberately not an error the person can work around by trying again.
    // An unverified address must never reach an existing account, and telling
    // them to verify it with the provider is the only real fix.
    return {
      ok: false,
      error: 'unverified_email',
      description: `${claim.provider} has not verified ${email}. Confirm the address with them first, then sign in again.`,
    };
  }

  const existing = store.accountByEmail(email);
  const account = existing ?? store.upsertAccount(email, () => newId('acc'));
  store.linkIdentity({ provider: claim.provider, subject: claim.subject, accountId: account.id, email });

  log.info(existing ? 'identity linked to an existing account' : 'account created from a sign-in', {
    account: account.id,
    provider: claim.provider,
  });
  return { ok: true, account, created: !existing, linked: Boolean(existing) };
}

/**
 * How an address is compared.
 *
 * Case only. Tempting and wrong to go further: `aman+test@gmail.com` and
 * `a.man@gmail.com` do reach the same Gmail inbox, and folding them would be
 * correct for Gmail and wrong for the many providers where a dot or a plus is
 * an ordinary character in a different person's address. Folding two people
 * into one account is a far worse failure than making one person sign in with
 * the address they actually used.
 */
export function sameEmail(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
