import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { signLicense, type Plan } from '@mjolnir/licensing';

/**
 * Give someone every feature.
 *
 *   npm run licence -- --init                     make a signing key pair
 *   npm run licence -- --email a@b.c              lifetime key for that email
 *   npm run licence -- --email a@b.c --plan annual
 *   npm run licence -- --list                     who has been granted
 *
 * Keys sign with ~/.mjolnir/licence-signing.key; the matching public key in
 * ~/.mjolnir/licence-public.pem is what the app verifies against (or the
 * MJOLNIR_LICENCE_PUBLIC_KEY env var). Grants are recorded in
 * ~/.mjolnir/granted.json so the list of comped emails is in one place.
 */

const dir = join(homedir(), '.mjolnir');
const privatePath = join(dir, 'licence-signing.key');
const publicPath = join(dir, 'licence-public.pem');
const grantedPath = join(dir, 'granted.json');

const args = new Map<string, string>();
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i] ?? '';
  if (arg.startsWith('--')) args.set(arg.slice(2), argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? 'true' : (argv[++i] ?? 'true'));
}

if (args.has('init')) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (existsSync(privatePath) && !args.has('force')) {
    console.log(`signing key exists at ${privatePath} (use --force to replace)`);
  } else {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    writeFileSync(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    writeFileSync(publicPath, publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o644 });
    console.log(`wrote ${privatePath} and ${publicPath}`);
  }
  process.exit(0);
}

const granted: Array<{ email: string; plan: Plan; jti: string; issuedAt: string }> = existsSync(grantedPath)
  ? (JSON.parse(readFileSync(grantedPath, 'utf8')) as typeof granted)
  : [];

if (args.has('list')) {
  for (const entry of granted) console.log(`${entry.issuedAt}  ${entry.plan.padEnd(8)}  ${entry.email}  ${entry.jti}`);
  if (!granted.length) console.log('nobody yet');
  process.exit(0);
}

const email = args.get('email');
if (!email || !email.includes('@')) {
  console.error('usage: --init | --list | --email <address> [--plan lifetime|annual|monthly] [--months N]');
  process.exit(2);
}
if (!existsSync(privatePath)) {
  console.error(`no signing key at ${privatePath}; run with --init first`);
  process.exit(2);
}
const plan = (args.get('plan') ?? 'lifetime') as Plan;
const now = Math.floor(Date.now() / 1000);
const months = Number(args.get('months') ?? (plan === 'monthly' ? 1 : 12));
const end = now + months * 30 * 86_400;
const jti = randomUUID();
const key = signLicense(
  {
    jti,
    email,
    plan,
    iat: now,
    expiresAt: plan === 'lifetime' ? null : end,
    updatesUntil: plan === 'lifetime' ? now + 365 * 86_400 * 100 : end,
    customerId: `granted:${email}`,
  },
  readFileSync(privatePath, 'utf8'),
);
granted.push({ email, plan, jti, issuedAt: new Date().toISOString() });
writeFileSync(grantedPath, JSON.stringify(granted, null, 2), { mode: 0o600 });
console.log(`licence for ${email} (${plan}):\n\n${key}\n`);
