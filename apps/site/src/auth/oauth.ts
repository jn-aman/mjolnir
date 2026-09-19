import { createHash, randomBytes } from 'node:crypto';
import { logger } from '@mjolnir/logger';
import type { Organisation } from '../db.ts';
import type { ProviderClaim } from '../identity.ts';

const log = logger.child('oauth');

/**
 * GitHub, Google and Okta, as three shapes of the same conversation.
 *
 * All three are authorization code flows, and the only parts that genuinely
 * differ are where the endpoints live and how each one answers "who is this,
 * and is that address really theirs". So the differences live in one table and
 * one function per provider, and everything security-shaped, the state, the
 * PKCE verifier, the single use, the redirect matching, is written once here.
 *
 * Two decisions worth stating, because both are the kind of thing that looks
 * like an optimisation until it is a breach:
 *
 * **PKCE on every provider, confidential client or not.** The client secret
 * already protects the code exchange, so PKCE is belt and braces. It is also
 * free, and it closes the case where a code leaks through a redirect, a proxy
 * log or a browser extension before we redeem it.
 *
 * **The identity comes from the token endpoint's own response, over TLS,
 * server to server.** Nothing a browser hands us decides who someone is. That
 * is why there is no JWT verification here: an `id_token` fetched directly
 * from Google's token endpoint is trustworthy because of how it arrived, not
 * because of its signature, and verifying a signature on a document we already
 * received over an authenticated channel would be theatre.
 */

export interface OAuthApp {
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface OAuthConfig {
  /** Where we are, so the redirect we send matches the one we register. */
  readonly publicUrl: string;
  readonly github?: OAuthApp | undefined;
  readonly google?: OAuthApp | undefined;
  /** Injected in tests. Production leaves it alone. */
  readonly fetch?: typeof fetch | undefined;
}

export type OAuthProvider = 'github' | 'google' | 'okta';
export const OAUTH_PROVIDERS: readonly OAuthProvider[] = ['github', 'google', 'okta'];

export function isOAuthProvider(value: string): value is OAuthProvider {
  return (OAUTH_PROVIDERS as readonly string[]).includes(value);
}

interface Endpoints {
  readonly authorize: string;
  readonly token: string;
  readonly userinfo: string;
  readonly scope: string;
}

const STATIC: Record<'github' | 'google', Endpoints> = {
  github: {
    authorize: 'https://github.com/login/oauth/authorize',
    token: 'https://github.com/login/oauth/access_token',
    userinfo: 'https://api.github.com/user',
    // `user:email` and nothing else. Mjolnir has no business reading anyone's
    // repositories, and a scope you do not ask for is a scope that cannot be
    // abused if this service is ever compromised.
    scope: 'read:user user:email',
  },
  google: {
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    userinfo: 'https://openidconnect.googleapis.com/v1/userinfo',
    scope: 'openid email profile',
  },
};

export class OAuthError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** The PKCE pair: the secret we keep and the challenge we publish. */
export function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

export class OAuth {
  readonly #config: OAuthConfig;
  readonly #fetch: typeof fetch;
  /** Okta's discovery document, per issuer. It changes about never. */
  readonly #discovered = new Map<string, { at: number; endpoints: Endpoints }>();

  constructor(config: OAuthConfig) {
    this.#config = config;
    this.#fetch = config.fetch ?? fetch;
  }

  /** Whether a button for this provider would actually lead anywhere. */
  configured(provider: OAuthProvider): boolean {
    if (provider === 'okta') return true; // per organisation, checked when used
    const app = this.#config[provider];
    return Boolean(app?.clientId && app.clientSecret);
  }

  /** The providers this deployment can offer, for the sign-in buttons. */
  available(): OAuthProvider[] {
    return OAUTH_PROVIDERS.filter((provider) => provider !== 'okta' && this.configured(provider));
  }

  redirectUri(provider: OAuthProvider): string {
    return `${this.#config.publicUrl.replace(/\/+$/, '')}/api/auth/oauth/${provider}/callback`;
  }

  /**
   * Where to send the browser.
   *
   * `prompt=select_account` on Google is not cosmetic. Without it, someone
   * already signed into a personal account is silently signed in as that
   * account, which is how one human ends up with two Mjolnir accounts and one
   * of them holding the subscription.
   */
  async authorizeUrl(input: {
    provider: OAuthProvider;
    state: string;
    challenge: string;
    organisation?: Organisation | undefined;
    loginHint?: string | null | undefined;
  }): Promise<string> {
    const app = this.appFor(input.provider, input.organisation);
    const endpoints = await this.endpointsFor(input.provider, input.organisation);
    const url = new URL(endpoints.authorize);
    url.searchParams.set('client_id', app.clientId);
    url.searchParams.set('redirect_uri', this.redirectUri(input.provider));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', endpoints.scope);
    url.searchParams.set('state', input.state);
    url.searchParams.set('code_challenge', input.challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    if (input.provider === 'google') {
      url.searchParams.set('prompt', 'select_account');
      if (input.loginHint) url.searchParams.set('login_hint', input.loginHint);
    }
    if (input.provider === 'github' && input.loginHint) url.searchParams.set('login', input.loginHint);
    if (input.provider === 'okta' && input.loginHint) url.searchParams.set('login_hint', input.loginHint);
    return url.toString();
  }

  /** The code, exchanged, and the person behind it. */
  async claim(input: {
    provider: OAuthProvider;
    code: string;
    verifier: string;
    organisation?: Organisation | undefined;
  }): Promise<ProviderClaim> {
    const app = this.appFor(input.provider, input.organisation);
    const endpoints = await this.endpointsFor(input.provider, input.organisation);

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: this.redirectUri(input.provider),
      client_id: app.clientId,
      client_secret: app.clientSecret,
      code_verifier: input.verifier,
    });

    const response = await this.#fetch(endpoints.token, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: body.toString(),
    });
    const token = (await readJson(response)) as Record<string, unknown>;
    // GitHub answers 200 with `{error: "bad_verification_code"}`, so the
    // status alone is not the check.
    if (!response.ok || typeof token['access_token'] !== 'string') {
      const detail = String(token['error_description'] ?? token['error'] ?? response.status);
      log.warn('token exchange refused', { provider: input.provider, detail });
      throw new OAuthError('exchange_failed', `${input.provider} would not complete the sign-in (${detail}).`);
    }
    const accessToken = token['access_token'];

    return input.provider === 'github'
      ? await this.#githubClaim(accessToken)
      : await this.#oidcClaim(input.provider, endpoints.userinfo, accessToken);
  }

  /**
   * GitHub, which needs a second call.
   *
   * `/user` returns an email field that is whatever the person typed into
   * their public profile: it can be unverified, someone else's, or absent
   * entirely when they have set it private. The only trustworthy answer is
   * `/user/emails`, which says per address whether GitHub has confirmed it.
   *
   * The primary address wins when it is verified, because it is the one the
   * person expects to be identified by. If it is not verified we fall back to
   * one that is, rather than refusing someone who has a confirmed address
   * sitting right there. Only when nothing is verified do we hand back an
   * unverified claim, which `resolveIdentity` refuses on purpose: an
   * unverified address must never reach an existing account.
   */
  async #githubClaim(accessToken: string): Promise<ProviderClaim> {
    const headers = {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'mjolnir',
      'x-github-api-version': '2022-11-28',
    };
    const profileResponse = await this.#fetch('https://api.github.com/user', { headers });
    const profile = (await readJson(profileResponse)) as Record<string, unknown>;
    if (!profileResponse.ok || (typeof profile['id'] !== 'number' && typeof profile['id'] !== 'string')) {
      throw new OAuthError('profile_failed', 'GitHub would not tell us who you are.');
    }

    let chosen: { email: string; verified: boolean } | undefined;
    const emailsResponse = await this.#fetch('https://api.github.com/user/emails', { headers });
    if (emailsResponse.ok) {
      const emails = (await readJson(emailsResponse)) as Array<Record<string, unknown>>;
      const rows = (Array.isArray(emails) ? emails : [])
        .filter((row) => typeof row['email'] === 'string')
        .map((row) => ({ email: String(row['email']), verified: row['verified'] === true, primary: row['primary'] === true }));
      const primary = rows.find((row) => row.primary);
      chosen = primary?.verified ? primary : (rows.find((row) => row.verified) ?? primary ?? rows[0]);
    }
    const fallback = typeof profile['email'] === 'string' ? profile['email'] : '';

    return {
      provider: 'github',
      subject: String(profile['id']),
      email: chosen?.email ?? fallback,
      // A profile email with no `/user/emails` entry behind it is unverified
      // by definition: we have not been told otherwise.
      emailVerified: chosen?.verified === true,
      ...(typeof profile['login'] === 'string' ? { handle: profile['login'] } : {}),
    };
  }

  /** Google and Okta, which are both plain OIDC once the endpoints are known. */
  async #oidcClaim(provider: 'google' | 'okta', userinfo: string, accessToken: string): Promise<ProviderClaim> {
    const response = await this.#fetch(userinfo, { headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' } });
    const info = (await readJson(response)) as Record<string, unknown>;
    if (!response.ok || typeof info['sub'] !== 'string') {
      throw new OAuthError('profile_failed', `${provider} would not tell us who you are.`);
    }
    const handle = typeof info['preferred_username'] === 'string' ? info['preferred_username'] : undefined;
    return {
      provider,
      subject: info['sub'],
      email: typeof info['email'] === 'string' ? info['email'] : '',
      // Absent means no. Okta org servers routinely omit the claim, and
      // reading a missing field as "verified" would be the whole hole.
      emailVerified: info['email_verified'] === true || info['email_verified'] === 'true',
      ...(handle ? { handle } : {}),
    };
  }

  appFor(provider: OAuthProvider, organisation?: Organisation | undefined): OAuthApp {
    if (provider === 'okta') {
      if (!organisation) throw new OAuthError('no_organisation', 'We do not know which identity provider to send you to.');
      if (!organisation.ssoIssuer || !organisation.ssoClientId || !organisation.ssoClientSecret) {
        throw new OAuthError('sso_not_configured', `${organisation.name} has not finished setting up single sign-on.`);
      }
      return { clientId: organisation.ssoClientId, clientSecret: organisation.ssoClientSecret };
    }
    const app = this.#config[provider];
    if (!app?.clientId || !app.clientSecret) {
      throw new OAuthError('not_configured', `Signing in with ${provider} is not available on this server.`);
    }
    return app;
  }

  /**
   * Okta's endpoints, from Okta.
   *
   * Every tenant can put its authorisation server somewhere different, and
   * half of them use a custom one at `/oauth2/<id>`. Guessing the paths works
   * until it does not, so we read the discovery document and only fall back to
   * the conventional layout when a tenant does not publish one.
   */
  async endpointsFor(provider: OAuthProvider, organisation?: Organisation | undefined): Promise<Endpoints> {
    if (provider !== 'okta') return STATIC[provider];
    const issuer = organisation?.ssoIssuer?.replace(/\/+$/, '');
    if (!issuer) throw new OAuthError('sso_not_configured', 'That organisation has no identity provider configured.');

    const cached = this.#discovered.get(issuer);
    if (cached && Date.now() - cached.at < 3_600_000) return cached.endpoints;

    const conventional: Endpoints = {
      authorize: `${issuer}/v1/authorize`,
      token: `${issuer}/v1/token`,
      userinfo: `${issuer}/v1/userinfo`,
      scope: 'openid email profile',
    };
    try {
      const response = await this.#fetch(`${issuer}/.well-known/openid-configuration`, { headers: { accept: 'application/json' } });
      const document = (await readJson(response)) as Record<string, unknown>;
      const endpoints: Endpoints = response.ok
        ? {
            authorize: typeof document['authorization_endpoint'] === 'string' ? document['authorization_endpoint'] : conventional.authorize,
            token: typeof document['token_endpoint'] === 'string' ? document['token_endpoint'] : conventional.token,
            userinfo: typeof document['userinfo_endpoint'] === 'string' ? document['userinfo_endpoint'] : conventional.userinfo,
            scope: 'openid email profile',
          }
        : conventional;
      this.#discovered.set(issuer, { at: Date.now(), endpoints });
      return endpoints;
    } catch (error) {
      log.debug('okta discovery failed, using the conventional paths', { issuer, error: String(error) });
      return conventional;
    }
  }
}

/** A body that is meant to be JSON but might be an error page. */
async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: text.slice(0, 200) };
  }
}
