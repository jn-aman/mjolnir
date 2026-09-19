import { z } from 'zod';

/**
 * How someone proves who they are.
 *
 * With a device grant the choosing happens in a browser, on our site, not in
 * this app: the app shows a code and the website decides what to put in front
 * of the person. That is the right split, and it is why adding a provider does
 * not need an app release.
 *
 * The app still has three jobs. It offers the buttons, so someone who signs in
 * with GitHub goes straight there instead of reading a code out loud for no
 * reason. It can carry a hint, so an enterprise that has Okta does not show
 * its staff a GitHub button they must not use. And it reports afterwards which
 * identity is signed in, because "signed in" with no name attached is not an
 * answer to "who is using this seat".
 */

export const PROVIDERS = ['email', 'github', 'google', 'okta'] as const;
export type ProviderId = (typeof PROVIDERS)[number];

export interface ProviderDescription {
  readonly id: ProviderId;
  readonly label: string;
  /** One line, for the button's tooltip. */
  readonly detail: string;
  /** Enterprise providers are configured per organisation, not globally. */
  readonly enterprise: boolean;
}

export const PROVIDER_CATALOGUE: Readonly<Record<ProviderId, ProviderDescription>> = {
  email: {
    id: 'email',
    label: 'Email me a code',
    detail: 'No password to forget, reset or have stolen. A six digit code, valid for ten minutes.',
    enterprise: false,
  },
  github: {
    id: 'github',
    label: 'Continue with GitHub',
    detail: 'Reads your email address and nothing else. No repository access is requested.',
    enterprise: false,
  },
  google: {
    id: 'google',
    label: 'Continue with Google',
    detail: 'Reads your email address and nothing else.',
    enterprise: false,
  },
  okta: {
    id: 'okta',
    label: 'Continue with Okta',
    detail: 'Your organisation signs you in. Seats are assigned by whoever administers it.',
    enterprise: true,
  },
};

/**
 * What the site says it can offer this person.
 *
 * Sent back with the device code so the app can render the right buttons
 * rather than a fixed list that goes stale the moment a provider is added or
 * an organisation turns one off. `enforced` is the enterprise case: a domain
 * that requires Okta must not be shown a GitHub button, because clicking it
 * would create a second identity for the same human.
 */
export const ProviderOfferSchema = z.object({
  available: z.array(z.enum(PROVIDERS)).default(['email']),
  /** When set, this is the only way in, and the app says why. */
  enforced: z.enum(PROVIDERS).nullable().default(null),
  /** For an enforced provider: whose policy it is, for the sentence on screen. */
  enforcedBy: z.string().nullable().default(null),
});
export type ProviderOffer = z.infer<typeof ProviderOfferSchema>;

/** Who is signed in, as the settings page shows them. */
export const IdentitySchema = z.object({
  provider: z.enum(PROVIDERS),
  email: z.string(),
  /** GitHub login, Okta username, or the email again. What a person recognises. */
  handle: z.string().optional(),
  /** The organisation, when an enterprise provider vouched for them. */
  organisation: z.string().optional(),
});
export type Identity = z.infer<typeof IdentitySchema>;

export function describeProvider(id: ProviderId): ProviderDescription {
  return PROVIDER_CATALOGUE[id];
}

/**
 * The buttons to render, in the order they should appear.
 *
 * An enforced provider is the only one. Otherwise the enterprise options come
 * last: they are the minority of sign-ins and the longest path, and putting
 * "Continue with Okta" first in a list most people cannot use is a small
 * cruelty repeated on every launch.
 */
export function offeredProviders(offer: ProviderOffer): ProviderDescription[] {
  if (offer.enforced) return [PROVIDER_CATALOGUE[offer.enforced]];
  const available = offer.available.length > 0 ? offer.available : (['email'] as ProviderId[]);
  const described = available.map((id) => PROVIDER_CATALOGUE[id]);
  return [...described.filter((p) => !p.enterprise), ...described.filter((p) => p.enterprise)];
}

/**
 * Why a provider is the only choice, in words for the sign-in screen.
 *
 * "Sign-in is restricted" with no reason reads as a bug. Naming the
 * organisation makes it a policy, which is what it is.
 */
export function enforcementNote(offer: ProviderOffer): string | null {
  if (!offer.enforced) return null;
  const who = offer.enforcedBy ? `${offer.enforcedBy} requires` : 'Your organisation requires';
  return `${who} everyone to sign in through ${PROVIDER_CATALOGUE[offer.enforced].label.replace(/^Continue with /, '')}.`;
}
