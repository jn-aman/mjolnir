import { randomBytes } from 'node:crypto';
import { Store } from '@mjolnir/site';
import { hashToken, newId } from '@mjolnir/site';

/**
 * Setting up an organisation, which is the one part of this that is a
 * conversation rather than a form.
 *
 *   npm run org -- --list
 *   npm run org -- --create "Acme" --domain acme.com
 *   npm run org -- --id org_x --sso https://acme.okta.com/oauth2/default --client-id A --client-secret B
 *   npm run org -- --id org_x --enforce            everyone on the domain must use it
 *   npm run org -- --id org_x --scim-token         mint one, print it once
 *   npm run org -- --id org_x --verify acme.com    mark a domain proved
 *
 * Enterprise onboarding happens on a call: someone sends their Okta issuer,
 * we send a SCIM token, they prove a domain. There is no self-service flow to
 * build yet and pretending otherwise would mean a half-finished admin UI that
 * still needs the call.
 *
 * `--verify` is the one to be careful with. Claiming a domain decides where
 * every sign-in on it is routed, so it goes in only once the DNS TXT record
 * has actually been seen.
 */

const argv = process.argv.slice(2);
const flags = new Map<string, string>();
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i] ?? '';
  if (!arg.startsWith('--')) continue;
  const next = argv[i + 1];
  const value = next && !next.startsWith('--') ? next : 'true';
  flags.set(arg.slice(2), value);
  if (value !== 'true') i += 1;
}

const databasePath = process.env['MJOLNIR_DB'] ?? `${process.env['HOME']}/.mjolnir/site.db`;
const store = new Store(databasePath);
const db = store.raw;

function list(): void {
  const rows = db.prepare('select * from organisations order by name').all() as Array<Record<string, unknown>>;
  if (rows.length === 0) {
    console.log('No organisations yet. Make one with --create "Name" --domain example.com');
    return;
  }
  for (const row of rows) {
    const domains = db.prepare('select domain, verified_at from domains where organisation_id = ?').all(String(row['id'])) as Array<
      Record<string, unknown>
    >;
    const seats = db.prepare('select count(*) as n from scim_users where organisation_id = ? and active = 1').get(String(row['id'])) as {
      n: number;
    };
    console.log(`\n${String(row['name'])}  ${String(row['id'])}`);
    console.log(`  domains     ${domains.map((d) => `${String(d['domain'])}${d['verified_at'] ? '' : ' (unverified)'}`).join(', ') || 'none'}`);
    console.log(`  sso         ${row['sso_issuer'] ? String(row['sso_issuer']) : 'not configured'}${Number(row['enforce_sso']) === 1 ? ', enforced' : ''}`);
    console.log(`  scim        ${row['scim_token_hash'] ? 'token issued' : 'no token'}, ${seats.n} active user(s)`);
  }
}

const name = flags.get('create');
if (name && name !== 'true') {
  const id = newId('org');
  db.prepare('insert into organisations (id, name, enforce_sso) values (?, ?, 0)').run(id, name);
  const domain = flags.get('domain');
  if (domain && domain !== 'true') {
    db.prepare('insert into domains (domain, organisation_id, verified_at, verification_token) values (?, ?, null, ?)').run(
      domain.toLowerCase(),
      id,
      `mjolnir-verify=${randomBytes(16).toString('hex')}`,
    );
    const token = db.prepare('select verification_token from domains where domain = ?').get(domain.toLowerCase()) as { verification_token: string };
    console.log(`Created ${name} as ${id}.`);
    console.log(`\nAsk them to add this TXT record at ${domain}, then run --verify ${domain}:`);
    console.log(`  ${token.verification_token}`);
  } else {
    console.log(`Created ${name} as ${id}.`);
  }
  store.close();
  process.exit(0);
}

const id = flags.get('id');
if (id && id !== 'true') {
  const organisation = store.organisationById(id);
  if (!organisation) {
    console.error(`No organisation ${id}.`);
    store.close();
    process.exit(1);
  }

  const issuer = flags.get('sso');
  if (issuer && issuer !== 'true') {
    db.prepare('update organisations set sso_issuer = ?, sso_client_id = ?, sso_client_secret = ? where id = ?').run(
      issuer.replace(/\/+$/, ''),
      flags.get('client-id') ?? organisation.ssoClientId,
      flags.get('client-secret') ?? organisation.ssoClientSecret,
      id,
    );
    console.log(`Single sign-on set for ${organisation.name}.`);
    console.log(`Redirect URI for their Okta app: ${process.env['MJOLNIR_PUBLIC_URL'] ?? 'https://api.mjolnir.sh'}/api/auth/oauth/okta/callback`);
  }

  if (flags.has('enforce')) {
    const on = flags.get('enforce') !== 'off';
    db.prepare('update organisations set enforce_sso = ? where id = ?').run(on ? 1 : 0, id);
    console.log(on ? 'Everyone on their domains must now use single sign-on.' : 'Single sign-on is no longer enforced.');
  }

  const verify = flags.get('verify');
  if (verify && verify !== 'true') {
    const changed = db
      .prepare('update domains set verified_at = ? where domain = ? and organisation_id = ?')
      .run(new Date().toISOString(), verify.toLowerCase(), id);
    console.log(Number(changed.changes) > 0 ? `${verify} is now theirs.` : `${verify} is not one of their domains.`);
  }

  if (flags.has('scim-token')) {
    const token = `scim_${randomBytes(32).toString('base64url')}`;
    store.setScimToken(id, hashToken(token));
    console.log('\nSCIM base URL and token for their Okta provisioning settings.');
    console.log(`  ${process.env['MJOLNIR_PUBLIC_URL'] ?? 'https://api.mjolnir.sh'}/scim/v2`);
    console.log(`  ${token}`);
    console.log('\nThis is the only time it is printed. We keep the hash, not the token.');
  }

  store.close();
  process.exit(0);
}

list();
store.close();
