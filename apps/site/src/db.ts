import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { logger } from '@mjolnir/logger';

const log = logger.child('db');

/**
 * The whole service's data, in one file.
 *
 * SQLite, deliberately. This stores accounts, devices and subscriptions for a
 * desktop app: tens of thousands of rows, single-digit writes per second at
 * the very best of times, and every query hitting an index. Postgres would be
 * a second thing to run, back up, patch and pay for, in exchange for
 * concurrency nobody here will use. The schema is ordinary SQL, so moving
 * later is a day's work and not a rewrite.
 *
 * What that does buy is an operational rule: **back up the file**. There is no
 * replica to fail over to. Litestream to object storage, continuously.
 */

export interface Account {
  readonly id: string;
  readonly email: string;
  readonly createdAt: string;
  /** Paddle customer id, once they have paid for anything. */
  readonly customerId: string | null;
  readonly organisationId: string | null;
}

export interface Subscription {
  readonly id: string;
  readonly accountId: string;
  readonly plan: 'monthly' | 'annual' | 'lifetime';
  readonly status: 'active' | 'past_due' | 'cancelled' | 'refunded';
  /** Seconds since epoch. Null for lifetime. */
  readonly expiresAt: number | null;
  readonly updatesUntil: number;
  /** Machines this licence covers at once. Five by default, bought in blocks. */
  readonly seats: number;
  readonly paddleSubscriptionId: string | null;
}

export interface Device {
  readonly id: string;
  readonly accountId: string;
  readonly name: string;
  readonly platform: string;
  readonly appVersion: string;
  readonly createdAt: string;
  readonly lastSeenAt: string;
  /** Hashed, never the token itself. */
  readonly refreshTokenHash: string | null;
  readonly revokedAt: string | null;
}

export interface Organisation {
  readonly id: string;
  readonly name: string;
  /** Okta issuer, client id, and the domains it claims. */
  readonly ssoIssuer: string | null;
  readonly ssoClientId: string | null;
  readonly ssoClientSecret: string | null;
  readonly enforceSso: boolean;
}

export interface PendingGrant {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly deviceId: string;
  readonly deviceName: string;
  readonly platform: string;
  readonly appVersion: string;
  readonly provider: string | null;
  readonly loginHint: string | null;
  readonly expiresAt: number;
  readonly interval: number;
  readonly accountId: string | null;
  readonly status: 'pending' | 'approved' | 'denied';
  /** Rate limiting: the last poll, so `slow_down` means something. */
  readonly lastPolledAt: number;
}

/**
 * Every table, created if missing.
 *
 * Written as one idempotent block rather than a migration framework, because
 * the first ten migrations of a service are always "add a column" and a
 * framework earns its keep later. `user_version` is bumped when that changes.
 */
const SCHEMA = `
  pragma journal_mode = wal;
  pragma foreign_keys = on;
  pragma busy_timeout = 5000;

  create table if not exists accounts (
    id text primary key,
    email text not null unique,
    created_at text not null,
    customer_id text,
    organisation_id text references organisations(id)
  );
  create index if not exists accounts_customer on accounts(customer_id);

  create table if not exists organisations (
    id text primary key,
    name text not null,
    sso_issuer text,
    sso_client_id text,
    sso_client_secret text,
    enforce_sso integer not null default 0
  );

  -- A domain belongs to one organisation, and only after it is proved.
  -- Without the proof, anyone with a Gmail address could claim google.com
  -- and take over every sign-in on it.
  create table if not exists domains (
    domain text primary key,
    organisation_id text not null references organisations(id),
    verified_at text,
    verification_token text not null
  );

  create table if not exists subscriptions (
    id text primary key,
    account_id text not null references accounts(id),
    plan text not null,
    status text not null,
    expires_at integer,
    updates_until integer not null,
    seats integer not null default 5,
    paddle_subscription_id text
  );
  create index if not exists subscriptions_account on subscriptions(account_id);
  create unique index if not exists subscriptions_paddle on subscriptions(paddle_subscription_id)
    where paddle_subscription_id is not null;

  create table if not exists devices (
    id text not null,
    account_id text not null references accounts(id),
    name text not null,
    platform text not null,
    app_version text not null,
    created_at text not null,
    last_seen_at text not null,
    refresh_token_hash text,
    revoked_at text,
    primary key (id, account_id)
  );
  create index if not exists devices_account on devices(account_id);
  create index if not exists devices_token on devices(refresh_token_hash);

  create table if not exists grants (
    device_code text primary key,
    user_code text not null unique,
    device_id text not null,
    device_name text not null,
    platform text not null,
    app_version text not null,
    provider text,
    login_hint text,
    expires_at integer not null,
    interval_seconds integer not null,
    account_id text,
    status text not null,
    last_polled_at integer not null
  );
  create index if not exists grants_expiry on grants(expires_at);

  -- One-time email codes. Hashed, because a leaked table should not be a
  -- leaked set of live sign-ins.
  create table if not exists email_codes (
    email text not null,
    code_hash text not null,
    expires_at integer not null,
    attempts integer not null default 0,
    primary key (email, code_hash)
  );

  -- Every lease ever issued, so a support question has an answer and a
  -- revoked device can be told apart from one that never asked.
  create table if not exists leases (
    nonce text primary key,
    account_id text not null references accounts(id),
    device_id text not null,
    issued_at integer not null,
    not_after integer not null
  );
  create index if not exists leases_device on leases(account_id, device_id);
`;

export class Store {
  readonly #db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.#db = new DatabaseSync(path);
    this.#db.exec(SCHEMA);
    log.info('store ready', { path });
  }

  close(): void {
    this.#db.close();
  }

  get raw(): DatabaseSync {
    return this.#db;
  }

  // ---- accounts -------------------------------------------------------

  accountByEmail(email: string): Account | null {
    const row = this.#db.prepare('select * from accounts where email = ?').get(normaliseEmail(email)) as Row | undefined;
    return row ? toAccount(row) : null;
  }

  accountById(id: string): Account | null {
    const row = this.#db.prepare('select * from accounts where id = ?').get(id) as Row | undefined;
    return row ? toAccount(row) : null;
  }

  accountByCustomerId(customerId: string): Account | null {
    const row = this.#db.prepare('select * from accounts where customer_id = ?').get(customerId) as Row | undefined;
    return row ? toAccount(row) : null;
  }

  /**
   * Finds the account for an email, creating it if there is none.
   *
   * Creation on first sight is deliberate: a payment can arrive before anyone
   * has signed in, and the purchase has to work before the account does.
   */
  upsertAccount(email: string, id: () => string): Account {
    const existing = this.accountByEmail(email);
    if (existing) return existing;
    const account: Account = {
      id: id(),
      email: normaliseEmail(email),
      createdAt: new Date().toISOString(),
      customerId: null,
      organisationId: this.organisationForEmail(email)?.id ?? null,
    };
    this.#db
      .prepare('insert into accounts (id, email, created_at, customer_id, organisation_id) values (?, ?, ?, ?, ?)')
      .run(account.id, account.email, account.createdAt, account.customerId, account.organisationId);
    log.info('account created', { id: account.id });
    return account;
  }

  setCustomerId(accountId: string, customerId: string): void {
    this.#db.prepare('update accounts set customer_id = ? where id = ?').run(customerId, accountId);
  }

  // ---- organisations --------------------------------------------------

  /** The organisation that has proved it owns this email's domain, if any. */
  organisationForEmail(email: string): Organisation | null {
    const domain = normaliseEmail(email).split('@')[1];
    if (!domain) return null;
    const row = this.#db
      .prepare(
        `select o.* from organisations o
         join domains d on d.organisation_id = o.id
         where d.domain = ? and d.verified_at is not null`,
      )
      .get(domain) as Row | undefined;
    return row ? toOrganisation(row) : null;
  }

  // ---- subscriptions --------------------------------------------------

  subscriptionFor(accountId: string): Subscription | null {
    // The most generous live subscription wins: someone who upgraded should
    // not be held to the row that happens to sort first.
    const row = this.#db
      .prepare(
        `select * from subscriptions
         where account_id = ? and status in ('active', 'past_due')
         order by case plan when 'lifetime' then 0 when 'annual' then 1 else 2 end,
                  coalesce(expires_at, 9999999999) desc
         limit 1`,
      )
      .get(accountId) as Row | undefined;
    return row ? toSubscription(row) : null;
  }

  saveSubscription(subscription: Subscription): void {
    this.#db
      .prepare(
        `insert into subscriptions (id, account_id, plan, status, expires_at, updates_until, seats, paddle_subscription_id)
         values (?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(id) do update set
           plan = excluded.plan, status = excluded.status, expires_at = excluded.expires_at,
           updates_until = excluded.updates_until, seats = excluded.seats,
           paddle_subscription_id = excluded.paddle_subscription_id`,
      )
      .run(
        subscription.id,
        subscription.accountId,
        subscription.plan,
        subscription.status,
        subscription.expiresAt,
        subscription.updatesUntil,
        subscription.seats,
        subscription.paddleSubscriptionId,
      );
  }

  subscriptionByPaddleId(paddleId: string): Subscription | null {
    const row = this.#db.prepare('select * from subscriptions where paddle_subscription_id = ?').get(paddleId) as Row | undefined;
    return row ? toSubscription(row) : null;
  }

  // ---- devices --------------------------------------------------------

  devicesFor(accountId: string): Device[] {
    return (this.#db.prepare('select * from devices where account_id = ? and revoked_at is null order by last_seen_at desc').all(accountId) as Row[]).map(toDevice);
  }

  /**
   * Devices holding a seat right now.
   *
   * A seat is held by a **live lease**, not by having signed in. Those are not
   * the same thing and conflating them was wrong in both directions: signing
   * in on a sixth machine just to look at the account page would have burned a
   * seat before that machine had a licence at all, and a machine that stopped
   * renewing would have kept its seat for sixty days after it stopped being
   * used.
   *
   * Tying it to the lease means a seat frees itself a week after a machine
   * stops asking, which is the same week the machine stops being Pro. One
   * clock, not two.
   */
  activeDevices(accountId: string, now = Math.floor(Date.now() / 1000)): Device[] {
    return (
      this.#db
        .prepare(
          `select d.* from devices d
           where d.account_id = ? and d.revoked_at is null
             and exists (
               select 1 from leases l
               where l.account_id = d.account_id and l.device_id = d.id and l.not_after > ?
             )
           order by d.last_seen_at desc`,
        )
        .all(accountId, now) as Row[]
    ).map(toDevice);
  }

  deviceByTokenHash(hash: string): Device | null {
    const row = this.#db.prepare('select * from devices where refresh_token_hash = ? and revoked_at is null').get(hash) as Row | undefined;
    return row ? toDevice(row) : null;
  }

  saveDevice(device: Device): void {
    this.#db
      .prepare(
        `insert into devices (id, account_id, name, platform, app_version, created_at, last_seen_at, refresh_token_hash, revoked_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(id, account_id) do update set
           name = excluded.name, platform = excluded.platform, app_version = excluded.app_version,
           last_seen_at = excluded.last_seen_at, refresh_token_hash = excluded.refresh_token_hash,
           revoked_at = excluded.revoked_at`,
      )
      .run(
        device.id,
        device.accountId,
        device.name,
        device.platform,
        device.appVersion,
        device.createdAt,
        device.lastSeenAt,
        device.refreshTokenHash,
        device.revokedAt,
      );
  }

  touchDevice(accountId: string, deviceId: string, appVersion: string): void {
    this.#db
      .prepare('update devices set last_seen_at = ?, app_version = ? where account_id = ? and id = ?')
      .run(new Date().toISOString(), appVersion, accountId, deviceId);
  }

  /**
   * Signs a machine out and frees its seat now.
   *
   * The lease rows go with it. Leaving them would mean the seat stayed held
   * for up to a week after someone deliberately signed a machine out, which is
   * exactly the moment they are trying to make room for another one.
   *
   * The lease already issued to that machine keeps working until it expires,
   * because it is signed and we cannot reach into it. That is the revocation
   * window, and it is why the window is a week.
   */
  revokeDevice(accountId: string, deviceId: string): void {
    this.#db
      .prepare('update devices set revoked_at = ?, refresh_token_hash = null where account_id = ? and id = ?')
      .run(new Date().toISOString(), accountId, deviceId);
    this.#db.prepare('delete from leases where account_id = ? and device_id = ?').run(accountId, deviceId);
  }

  /** Every device of an account, for SCIM deprovisioning and account closure. */
  revokeAllDevices(accountId: string): number {
    const result = this.#db
      .prepare('update devices set revoked_at = ?, refresh_token_hash = null where account_id = ? and revoked_at is null')
      .run(new Date().toISOString(), accountId);
    this.#db.prepare('delete from leases where account_id = ?').run(accountId);
    return Number(result.changes);
  }

  // ---- grants ---------------------------------------------------------

  saveGrant(grant: PendingGrant): void {
    this.#db
      .prepare(
        `insert into grants (device_code, user_code, device_id, device_name, platform, app_version, provider, login_hint,
                             expires_at, interval_seconds, account_id, status, last_polled_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(device_code) do update set
           account_id = excluded.account_id, status = excluded.status, last_polled_at = excluded.last_polled_at`,
      )
      .run(
        grant.deviceCode,
        grant.userCode,
        grant.deviceId,
        grant.deviceName,
        grant.platform,
        grant.appVersion,
        grant.provider,
        grant.loginHint,
        grant.expiresAt,
        grant.interval,
        grant.accountId,
        grant.status,
        grant.lastPolledAt,
      );
  }

  grantByDeviceCode(code: string): PendingGrant | null {
    const row = this.#db.prepare('select * from grants where device_code = ?').get(code) as Row | undefined;
    return row ? toGrant(row) : null;
  }

  grantByUserCode(code: string): PendingGrant | null {
    const row = this.#db.prepare('select * from grants where user_code = ?').get(code.toUpperCase()) as Row | undefined;
    return row ? toGrant(row) : null;
  }

  deleteGrant(deviceCode: string): void {
    this.#db.prepare('delete from grants where device_code = ?').run(deviceCode);
  }

  /** Housekeeping: abandoned sign-ins and spent codes do not accumulate. */
  sweep(now = Math.floor(Date.now() / 1000)): { grants: number; codes: number } {
    const grants = this.#db.prepare('delete from grants where expires_at < ?').run(now);
    const codes = this.#db.prepare('delete from email_codes where expires_at < ?').run(now);
    return { grants: Number(grants.changes), codes: Number(codes.changes) };
  }

  // ---- email codes ----------------------------------------------------

  saveEmailCode(email: string, codeHash: string, expiresAt: number): void {
    this.#db
      .prepare('insert or replace into email_codes (email, code_hash, expires_at, attempts) values (?, ?, ?, 0)')
      .run(normaliseEmail(email), codeHash, expiresAt);
  }

  /**
   * Checks a code and spends it.
   *
   * Attempts are counted so a six digit code cannot be brute forced: a
   * million guesses at five tries is not a risk, at unlimited tries it is a
   * certainty.
   */
  claimEmailCode(email: string, codeHash: string, now = Math.floor(Date.now() / 1000)): 'ok' | 'wrong' | 'expired' | 'too-many' {
    const address = normaliseEmail(email);
    const row = this.#db.prepare('select * from email_codes where email = ? and code_hash = ?').get(address, codeHash) as Row | undefined;
    if (!row) {
      this.#db.prepare('update email_codes set attempts = attempts + 1 where email = ?').run(address);
      const attempts = this.#db.prepare('select max(attempts) as a from email_codes where email = ?').get(address) as { a?: number } | undefined;
      return (attempts?.a ?? 0) >= 5 ? 'too-many' : 'wrong';
    }
    if (Number(row['expires_at']) < now) {
      this.#db.prepare('delete from email_codes where email = ? and code_hash = ?').run(address, codeHash);
      return 'expired';
    }
    if (Number(row['attempts']) >= 5) return 'too-many';
    this.#db.prepare('delete from email_codes where email = ?').run(address);
    return 'ok';
  }

  // ---- leases ---------------------------------------------------------

  /**
   * Records a lease, replacing the one that device already had.
   *
   * One row per device, not one per issue. Renewing is not taking a second
   * seat, and a history of every lease ever signed would grow without bound
   * for no question anyone asks.
   */
  recordLease(nonce: string, accountId: string, deviceId: string, issuedAt: number, notAfter: number): void {
    this.#db.prepare('delete from leases where account_id = ? and device_id = ?').run(accountId, deviceId);
    this.#db
      .prepare('insert into leases (nonce, account_id, device_id, issued_at, not_after) values (?, ?, ?, ?, ?)')
      .run(nonce, accountId, deviceId, issuedAt, notAfter);
  }
}

type Row = Record<string, unknown>;

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toAccount(row: Row): Account {
  return {
    id: String(row['id']),
    email: String(row['email']),
    createdAt: String(row['created_at']),
    customerId: row['customer_id'] === null ? null : String(row['customer_id']),
    organisationId: row['organisation_id'] === null ? null : String(row['organisation_id']),
  };
}

function toSubscription(row: Row): Subscription {
  return {
    id: String(row['id']),
    accountId: String(row['account_id']),
    plan: String(row['plan']) as Subscription['plan'],
    status: String(row['status']) as Subscription['status'],
    expiresAt: row['expires_at'] === null ? null : Number(row['expires_at']),
    updatesUntil: Number(row['updates_until']),
    seats: Number(row['seats']),
    paddleSubscriptionId: row['paddle_subscription_id'] === null ? null : String(row['paddle_subscription_id']),
  };
}

function toDevice(row: Row): Device {
  return {
    id: String(row['id']),
    accountId: String(row['account_id']),
    name: String(row['name']),
    platform: String(row['platform']),
    appVersion: String(row['app_version']),
    createdAt: String(row['created_at']),
    lastSeenAt: String(row['last_seen_at']),
    refreshTokenHash: row['refresh_token_hash'] === null ? null : String(row['refresh_token_hash']),
    revokedAt: row['revoked_at'] === null ? null : String(row['revoked_at']),
  };
}

function toOrganisation(row: Row): Organisation {
  return {
    id: String(row['id']),
    name: String(row['name']),
    ssoIssuer: row['sso_issuer'] === null ? null : String(row['sso_issuer']),
    ssoClientId: row['sso_client_id'] === null ? null : String(row['sso_client_id']),
    ssoClientSecret: row['sso_client_secret'] === null ? null : String(row['sso_client_secret']),
    enforceSso: Number(row['enforce_sso']) === 1,
  };
}

function toGrant(row: Row): PendingGrant {
  return {
    deviceCode: String(row['device_code']),
    userCode: String(row['user_code']),
    deviceId: String(row['device_id']),
    deviceName: String(row['device_name']),
    platform: String(row['platform']),
    appVersion: String(row['app_version']),
    provider: row['provider'] === null ? null : String(row['provider']),
    loginHint: row['login_hint'] === null ? null : String(row['login_hint']),
    expiresAt: Number(row['expires_at']),
    interval: Number(row['interval_seconds']),
    accountId: row['account_id'] === null ? null : String(row['account_id']),
    status: String(row['status']) as PendingGrant['status'],
    lastPolledAt: Number(row['last_polled_at']),
  };
}
