import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { SANDBOX_CATALOGUE } from '@mjolnir/paddle';
import { logger } from '@mjolnir/logger';
import { Store } from './db.ts';
import { createSigner } from './signing.ts';
import { deviceRoutes } from './routes/device.ts';
import { accountRoutes } from './routes/account.ts';
import { paddleRoutes } from './routes/paddle.ts';
import { authRoutes } from './routes/auth.ts';
import { scimRoutes } from './routes/scim.ts';
import { wwwRoutes } from './www/routes.ts';
import { updateRoutes } from './routes/updates.ts';
import { OAuth, type OAuthConfig } from './auth/oauth.ts';

const log = logger.child('site');

/**
 * api.mjolnir.sh.
 *
 * One process: the device grant, the account, the licence, and the webhook
 * that turns a payment into a subscription. It is deliberately small, because
 * the thing it protects is a signing key and the blast radius of a service
 * with a signing key should be as small as it can be made.
 *
 * It runs with no configuration at all for development: an in-memory store, a
 * throwaway key pair, and codes printed to the log instead of emailed. That is
 * not a shortcut, it is what makes the sign-in flow testable end to end
 * without an email provider or a Paddle account.
 */

export interface SiteOptions {
  readonly port?: number;
  readonly databasePath?: string;
  readonly signingKeyPem?: string;
  readonly verificationUri?: string;
  readonly paddleSecret?: string;
  /** Sends a code. Absent in development, where codes go to the log. */
  readonly sendEmail?: (to: string, code: string) => Promise<void>;
  readonly customerEmail?: (customerId: string) => Promise<string | null>;
  /** GitHub and Google apps, and where we are. From the environment otherwise. */
  readonly oauth?: Partial<OAuthConfig>;
}

export async function startSite(options: SiteOptions = {}): Promise<{ port: number; store: Store; close: () => void }> {
  const store = new Store(options.databasePath ?? process.env['MJOLNIR_DB'] ?? ':memory:');
  const signer = createSigner(options.signingKeyPem ?? signingKey());
  const secret = options.paddleSecret ?? process.env['PADDLE_WEBHOOK_SECRET'] ?? '';
  const verificationUri = options.verificationUri ?? process.env['MJOLNIR_VERIFY_URI'] ?? 'https://mjolnir.sh/device';
  const publicUrl = options.oauth?.publicUrl ?? process.env['MJOLNIR_PUBLIC_URL'] ?? 'https://api.mjolnir.sh';
  const oauth = new OAuth({
    publicUrl,
    ...(options.oauth?.github ?? oauthApp('GITHUB') ? { github: options.oauth?.github ?? oauthApp('GITHUB') } : {}),
    ...(options.oauth?.google ?? oauthApp('GOOGLE') ? { google: options.oauth?.google ?? oauthApp('GOOGLE') } : {}),
    ...(options.oauth?.fetch ? { fetch: options.oauth.fetch } : {}),
  });
  // Okta is per organisation, so it is always on offer and only appears to
  // people whose domain has a tenant configured.
  log.info('sign-in providers', { available: ['email', ...oauth.available(), 'okta'] });

  const app = express();
  app.disable('x-powered-by');

  // The webhook is mounted before the JSON parser on purpose: its signature
  // covers the raw bytes, and a parsed-then-restringified body is not those
  // bytes.
  if (secret) {
    app.use(
      '/api/webhooks/paddle',
      paddleRoutes(store, {
        secret,
        catalogue: SANDBOX_CATALOGUE,
        customerEmail: options.customerEmail ?? (async () => null),
      }),
    );
  } else {
    log.warn('no Paddle webhook secret, so payments will not be accepted');
  }

  // SCIM sends `application/scim+json`, which the ordinary JSON parser
  // ignores, so the body would arrive undefined and every provisioning call
  // would look like a malformed request.
  app.use(express.json({ limit: '1mb', type: ['application/json', 'application/scim+json'] }));
  app.get('/health', (_req, res) => res.json({ ok: true }));

  app.use('/api/device', deviceRoutes(store, { verificationUri, apiUrl: publicUrl, oauthProviders: oauth.available() }));
  app.use('/api', accountRoutes(store, signer));
  app.use('/api/auth', authRoutes(store, options.sendEmail, oauth));
  app.use('/scim/v2', scimRoutes(store, { publicUrl }));
  app.use('/updates', updateRoutes({ directory: process.env['MJOLNIR_UPDATES_DIR'] ?? '/data/updates' }));

  /*
   * The website, last.
   *
   * After every API route, so a page can never shadow an endpoint, and in the
   * same process so there is one thing to deploy. `/device` is the reason it
   * lives here rather than on a static host: it talks to the API beside it,
   * with no second origin and no CORS to get wrong.
   */
  app.use(
    wwwRoutes({
      version: process.env['MJOLNIR_VERSION'] ?? '0.1.0',
      updatesDir: process.env['MJOLNIR_UPDATES_DIR'] ?? '/data/updates',
      ...(releaseInfo() ? { release: releaseInfo() } : {}),
    }),
  );

  // Abandoned sign-ins and spent codes do not accumulate.
  const sweeper = setInterval(() => {
    const swept = store.sweep();
    if (swept.grants + swept.codes + swept.states > 0) log.debug('swept', swept);
  }, 60_000);
  sweeper.unref();

  const port = options.port ?? Number(process.env['PORT'] ?? 8787);
  const server = app.listen(port, '0.0.0.0');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const actual = (server.address() as { port: number }).port;
  log.info('site listening', { port: actual });

  return {
    port: actual,
    store,
    close: () => {
      clearInterval(sweeper);
      server.close();
      store.close();
    },
  };
}

/**
 * The published release, if the deploy was told about one.
 *
 * Read from the environment rather than from a build constant so publishing a
 * new version does not need this service rebuilt: the release flow writes
 * these and restarts it.
 */
function releaseInfo() {
  const version = process.env['MJOLNIR_RELEASE_VERSION'];
  if (!version) return undefined;
  return {
    version,
    ...(process.env['MJOLNIR_RELEASE_ARM64'] ? { arm64: process.env['MJOLNIR_RELEASE_ARM64'] } : {}),
    ...(process.env['MJOLNIR_RELEASE_INTEL'] ? { intel: process.env['MJOLNIR_RELEASE_INTEL'] } : {}),
    ...(process.env['MJOLNIR_RELEASE_NOTES'] ? { notes: process.env['MJOLNIR_RELEASE_NOTES'] } : {}),
    ...(process.env['MJOLNIR_RELEASE_AT'] ? { publishedAt: process.env['MJOLNIR_RELEASE_AT'] } : {}),
  };
}

/**
 * A provider's app, when both halves are present.
 *
 * Half-configured is the same as not configured: a client id with no secret
 * produces a button that fails at the exchange, which is worse than a button
 * that is not there.
 */
function oauthApp(prefix: string): { clientId: string; clientSecret: string } | undefined {
  const clientId = process.env[`${prefix}_CLIENT_ID`] ?? '';
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`] ?? '';
  return clientId && clientSecret ? { clientId, clientSecret } : undefined;
}

/**
 * The signing key.
 *
 * From the environment in production, where it belongs in a secret manager and
 * never on a disk we own. In development a key pair is made once and kept
 * beside the database, so restarting does not invalidate every lease issued a
 * minute ago, and the matching public key is written out for the app to trust.
 */
function signingKey(): string {
  /*
   * A path, in preference to the key itself.
   *
   * Two reasons, and the second is the important one. A PEM is multi-line, and
   * every layer between a secret manager and a process has its own opinion
   * about what a backslash-n in an environment variable means; systemd's
   * EnvironmentFile and this code disagreed, and the result was a key that
   * decoded to nothing with an OpenSSL error that says only "unsupported".
   *
   * The second reason is that a key in the environment is readable from
   * /proc/<pid>/environ, turns up in crash reports and in anything that dumps
   * its own configuration, and is inherited by every child process. A path is
   * none of those things.
   */
  const fromFile = process.env['MJOLNIR_LICENCE_KEY_FILE'];
  if (fromFile) {
    if (!existsSync(fromFile)) throw new Error(`MJOLNIR_LICENCE_KEY_FILE points at ${fromFile}, which is not there`);
    return readFileSync(fromFile, 'utf8');
  }

  const fromEnv = process.env['MJOLNIR_LICENCE_PRIVATE_KEY'];
  if (fromEnv) return fromEnv.replace(/\\n/g, '\n');

  const dir = join(homedir(), '.mjolnir');
  const privatePath = join(dir, 'licence-signing.key');
  const publicPath = join(dir, 'licence-public.pem');
  if (existsSync(privatePath)) return readFileSync(privatePath, 'utf8');

  log.warn('no signing key configured; making a development one');
  const pair = generateKeyPairSync('ed25519');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const privatePem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  writeFileSync(privatePath, privatePem, { mode: 0o600 });
  writeFileSync(publicPath, pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(), { mode: 0o644 });
  return privatePem;
}

if (process.argv[1]?.endsWith('main.ts') || process.argv[1]?.endsWith('main.js')) {
  await startSite();
}
