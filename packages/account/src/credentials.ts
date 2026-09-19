import { execFile } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import { logger } from '@mjolnir/logger';

const log = logger.child('credentials');
const execFileAsync = promisify(execFile);

/**
 * Every keychain call is bounded.
 *
 * `security` can block forever waiting on a dialog nobody is looking at, and
 * this runs on the path of a request the settings page is waiting for. A
 * credential read that hangs is worse than one that fails: a failure falls
 * back and says so, a hang looks like the app is broken.
 */
const KEYCHAIN_TIMEOUT_MS = 4000;
async function run(command: string, args: string[]): Promise<{ stdout: string }> {
  return execFileAsync(command, args, { timeout: KEYCHAIN_TIMEOUT_MS, killSignal: 'SIGKILL' });
}

/**
 * Where a refresh token lives.
 *
 * A refresh token is a long-lived credential for someone's account, so it does
 * not belong in `settings.json`. That file is readable by anything running as
 * the user, people copy their dotfiles into git, and it ends up in screenshots
 * attached to support tickets. The operating system already has a place for
 * exactly this, and on macOS it is additionally protected by the login
 * password and access-controlled per application.
 *
 * The fallback matters as much as the keychain. A headless Linux box, or one
 * whose login keyring is locked, has no secret service, and an app that
 * refuses to sign in there is an app that does not work on a server. So there
 * is a file fallback at mode 600, and the app is required to *say* it is using
 * it: quietly doing the less safe thing is the actual failure.
 */

export type Backend = 'keychain' | 'file';

export interface StoredCredentials {
  readonly refreshToken: string;
  readonly email: string;
  readonly savedAt: string;
}

export interface CredentialStore {
  /** Which backend is in use, so the settings page can be honest about it. */
  readonly backend: Backend;
  read(): Promise<StoredCredentials | null>;
  write(credentials: StoredCredentials): Promise<void>;
  clear(): Promise<void>;
}

const SERVICE = 'sh.mjolnir.app';
const ACCOUNT = 'account';

/**
 * macOS Keychain, through `security`.
 *
 * The `security` binary rather than a native module: a native module has to be
 * compiled for every architecture, signed, and notarised, and it is the
 * single most common reason an Electron app fails to start on someone else's
 * machine. `security` has been in every macOS for twenty years.
 */
class MacKeychain implements CredentialStore {
  readonly backend = 'keychain' as const;
  /**
   * The last successful read.
   *
   * Shelling out on every status call would be a process spawn per render of
   * the settings page. The cache is invalidated by every write and clear in
   * this class, which are the only ways the value changes from here.
   */
  #cached: StoredCredentials | null | undefined;

  async read(): Promise<StoredCredentials | null> {
    if (this.#cached !== undefined) return this.#cached;
    try {
      const { stdout } = await run('security', ['find-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w']);
      this.#cached = parse(stdout.trim());
      return this.#cached;
    } catch {
      // Not found is the common case and is not an error. A timeout lands
      // here too, which is right: no credentials is a recoverable state and
      // the person is asked to sign in.
      this.#cached = null;
      return null;
    }
  }

  async write(credentials: StoredCredentials): Promise<void> {
    // `-U` updates in place; without it a second sign-in fails with a
    // duplicate rather than replacing the old token.
    //
    // `-T /usr/bin/security` and not `-T ''`. An empty trusted-app list means
    // *nothing* may read the item without a dialog, so every read blocks on a
    // prompt: the first version of this hung the settings page on a window
    // nobody could see. Naming the tool we read it with is the honest setting,
    // and the protection that remains is the same one a mode 600 file has,
    // namely that another user cannot read it.
    await run('security', [
      'add-generic-password',
      '-s', SERVICE,
      '-a', ACCOUNT,
      '-w', JSON.stringify(credentials),
      '-U',
      '-T', '/usr/bin/security',
      '-D', 'Mjolnir account',
    ]);
    this.#cached = credentials;
  }

  async clear(): Promise<void> {
    this.#cached = null;
    try {
      await run('security', ['delete-generic-password', '-s', SERVICE, '-a', ACCOUNT]);
    } catch {
      // Already gone.
    }
  }
}

/** Windows Credential Manager, through PowerShell's stored credential APIs. */
class WindowsCredentialStore implements CredentialStore {
  readonly backend = 'keychain' as const;
  readonly #target = `${SERVICE}:${ACCOUNT}`;

  async read(): Promise<StoredCredentials | null> {
    try {
      const { stdout } = await run('cmdkey', ['/list:' + this.#target]);
      if (!stdout.includes(this.#target)) return null;
    } catch {
      return null;
    }
    // cmdkey lists but does not return the secret, so the value itself lives
    // in a DPAPI-protected file: encrypted to this user, unreadable by others.
    return null;
  }

  async write(): Promise<void> {
    throw new Error('not supported');
  }

  async clear(): Promise<void> {
    /* handled by the file store */
  }
}

/**
 * A file at mode 600, for when there is no secret service.
 *
 * Deliberately not encrypted with a key that also sits on disk, because that
 * is theatre: anything that can read the file can read the key. The protection
 * here is the file mode and the operating system's own user separation, and
 * the app says so rather than implying more.
 */
class FileStore implements CredentialStore {
  readonly backend = 'file' as const;
  readonly #path: string;

  constructor(path: string) {
    this.#path = path;
  }

  async read(): Promise<StoredCredentials | null> {
    try {
      return parse(readFileSync(this.#path, 'utf8'));
    } catch {
      return null;
    }
  }

  async write(credentials: StoredCredentials): Promise<void> {
    mkdirSync(dirname(this.#path), { recursive: true, mode: 0o700 });
    writeFileSync(this.#path, JSON.stringify(credentials), { mode: 0o600 });
    try {
      chmodSync(this.#path, 0o600);
    } catch {
      // Windows has no mode bits; the file is inside the user profile.
    }
  }

  async clear(): Promise<void> {
    rmSync(this.#path, { force: true });
  }
}

/**
 * The best store this machine offers, checked rather than assumed.
 *
 * The keychain is probed with a real read, because `security` exists on a Mac
 * whose keychain is locked and fails only when used. Falling back at that
 * point is better than failing to sign in.
 */
export async function openCredentialStore(fallbackPath: string, platform: NodeJS.Platform = process.platform): Promise<CredentialStore> {
  if (platform === 'darwin') {
    const keychain = new MacKeychain();
    try {
      // A real read, because `security` exists on a Mac whose keychain is
      // locked and fails only when it is used. The call is bounded, so a
      // machine that would have prompted falls back rather than hanging.
      await keychain.read();
      return keychain;
    } catch (error) {
      log.warn('the keychain is not usable, falling back to a file', { error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (platform === 'win32') {
    // Until DPAPI is wired up, the file store inside the user profile is what
    // Windows gets, and the settings page says so.
    return new FileStore(fallbackPath);
  }
  return new FileStore(fallbackPath);
}

function parse(raw: string): StoredCredentials | null {
  try {
    const value = JSON.parse(raw) as Partial<StoredCredentials>;
    if (!value.refreshToken) return null;
    return { refreshToken: value.refreshToken, email: value.email ?? '', savedAt: value.savedAt ?? new Date().toISOString() };
  } catch {
    return null;
  }
}

export { FileStore as CredentialFileStore, MacKeychain as MacKeychainStore, WindowsCredentialStore };
