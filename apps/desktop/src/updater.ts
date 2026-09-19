import { createRequire } from 'node:module';
import { ENDPOINTS } from '@mjolnir/endpoints';
import { logger } from '@mjolnir/logger';

const log = logger.child('updater');
const require_ = createRequire(import.meta.url);
const electron = require_('electron') as typeof import('electron');
const { app, dialog, shell, Notification } = electron;

/**
 * Updates, from our own domain, with the person in the loop.
 *
 * The feed is `updates.mjolnir.sh/<channel>/<platform>`, which is object
 * storage behind our apex rather than a third party's CDN, so a network that
 * allows `*.mjolnir.sh` and nothing else can still update the app.
 *
 * Silent-install-on-quit is the default because an outdated Kubernetes client
 * is a real hazard and nobody reads an update prompt at the moment it appears.
 * It is still a default and not a policy: turning it off means the app tells
 * you and waits, and a version you skip stays skipped.
 *
 * Every dialog here says the version it is talking about. An update prompt
 * that will not name what it is installing is one people learn to dismiss.
 */

type UpdateInfo = { version: string; releaseNotes?: string | null };

export interface UpdatePreferences {
  readonly channel: 'stable' | 'beta';
  readonly automatic: boolean;
  readonly checkOnLaunch: boolean;
  readonly skipped: string;
}

export interface UpdateState {
  readonly status: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'current' | 'error' | 'unsupported';
  readonly version?: string;
  readonly percent?: number;
  readonly error?: string;
  readonly checkedAt?: string;
  /**
   * What changed, as the release said it.
   *
   * Carried all the way through rather than dropped, because somebody being
   * asked to restart what they are doing is entitled to know what they get
   * for it. "Minor bug fixes and improvements" is what an app says when it
   * has not bothered, and it teaches people to dismiss the prompt.
   */
  readonly notes?: string;
}

type Autoupdater = {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  channel: string | null;
  logger: unknown;
  setFeedURL(options: { provider: 'generic'; url: string; channel?: string }): void;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(silent?: boolean, forceRunAfter?: boolean): void;
  on(event: string, listener: (...args: never[]) => void): void;
};

let updater: Autoupdater | null = null;
let state: UpdateState = { status: 'idle' };
let prefs: UpdatePreferences = { channel: 'stable', automatic: true, checkOnLaunch: true, skipped: '' };
let onChange: (next: UpdateState) => void = () => {};

/** The channel file lives per platform and architecture, beside the artefacts. */
function feedUrl(channel: string): string {
  const platform = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux';
  return `${ENDPOINTS.updates}/${channel}/${platform}/${process.arch}`;
}

function set(next: UpdateState): void {
  state = next;
  onChange(next);
}

export function updateState(): UpdateState {
  return state;
}

export function setPreferences(next: UpdatePreferences): void {
  prefs = next;
  if (!updater) return;
  updater.channel = next.channel;
  updater.allowPrerelease = next.channel === 'beta';
  updater.autoDownload = next.automatic;
  updater.autoInstallOnAppQuit = next.automatic;
  updater.setFeedURL({ provider: 'generic', url: feedUrl(next.channel), channel: next.channel });
}

export function initUpdater(preferences: UpdatePreferences, notify: (next: UpdateState) => void): void {
  onChange = notify;
  prefs = preferences;
  if (!app.isPackaged) {
    // electron-updater refuses to run from a source tree, and rightly so.
    set({ status: 'unsupported' });
    return;
  }
  try {
    const module_ = require_('electron-updater') as { autoUpdater: Autoupdater };
    updater = module_.autoUpdater;
  } catch (error) {
    log.warn('electron-updater is not installed in this build', { error: String(error) });
    set({ status: 'unsupported' });
    return;
  }

  updater.logger = { info: log.info.bind(log), warn: log.warn.bind(log), error: log.error.bind(log), debug: () => {} };
  setPreferences(preferences);

  updater.on('checking-for-update', () => set({ status: 'checking' }));
  updater.on('update-not-available', () => set({ status: 'current', checkedAt: new Date().toISOString() }));
  updater.on('update-available', ((info: UpdateInfo) => {
    const notes = plainNotes(info.releaseNotes);
    set({ status: 'available', version: info.version, checkedAt: new Date().toISOString(), ...(notes ? { notes } : {}) });
    if (info.version === prefs.skipped) return;
    /*
     * Say something, either way.
     *
     * On automatic the download starts on its own and the old code said
     * nothing until it was ready to restart, so the first a person heard of a
     * new version was a dialog asking them to quit. A notification is the
     * right weight for news that needs no decision: it says what arrived and
     * gets out of the way.
     */
    if (prefs.automatic) notifyAvailable(info.version, notes);
    else void promptForDownload(info.version, notes);
  }) as (...args: never[]) => void);
  updater.on('download-progress', ((progress: { percent: number }) => {
    set({ status: 'downloading', version: state.version ?? '', percent: Math.round(progress.percent) });
  }) as (...args: never[]) => void);
  updater.on('update-downloaded', ((info: UpdateInfo) => {
    const notes = plainNotes(info.releaseNotes) || state.notes;
    set({ status: 'ready', version: info.version, ...(notes ? { notes } : {}) });
    void promptForInstall(info.version, notes);
  }) as (...args: never[]) => void);
  updater.on('error', ((error: Error) => {
    set({ status: 'error', error: error.message });
  }) as (...args: never[]) => void);

  if (preferences.checkOnLaunch) {
    // Not in the first seconds: a launch is busy enough without a network call
    // competing with the first cluster connection.
    setTimeout(() => void check(false), 8000).unref?.();
    setInterval(() => void check(false), 6 * 60 * 60 * 1000).unref?.();
  }
}

export async function check(interactive: boolean): Promise<UpdateState> {
  if (!updater) {
    if (interactive) {
      await dialog.showMessageBox({
        type: 'info',
        message: 'This build does not update itself',
        detail: app.isPackaged
          ? 'Download the current version from mjolnir.sh.'
          : 'You are running from source. Pull and rebuild to update.',
        buttons: ['OK', 'Open mjolnir.sh'],
        defaultId: 0,
      }).then((result) => {
        if (result.response === 1) void shell.openExternal(ENDPOINTS.releases);
      });
    }
    return state;
  }
  try {
    await updater.checkForUpdates();
    if (interactive && state.status === 'current') {
      await dialog.showMessageBox({
        type: 'info',
        message: `Mjolnir ${app.getVersion()} is the current version`,
        detail: `Checked ${prefs.channel === 'beta' ? 'the beta channel' : 'the stable channel'} just now.`,
        buttons: ['OK'],
      });
    }
  } catch (error) {
    set({ status: 'error', error: error instanceof Error ? error.message : String(error) });
    if (interactive) {
      await dialog.showMessageBox({
        type: 'warning',
        message: 'Could not check for updates',
        detail: `${state.error ?? ''}\n\nMjolnir only contacts updates.mjolnir.sh. If this network blocks it, updates have to be downloaded by hand.`,
        buttons: ['OK'],
      });
    }
  }
  return state;
}

/**
 * A notification, for news that needs no decision.
 *
 * Silent on purpose: an update is not urgent, and a sound for something the
 * app is already handling by itself is the kind of thing people turn off
 * notifications over. Clicking it opens the dialog that does ask something.
 */
function notifyAvailable(version: string, notes: string): void {
  if (!Notification.isSupported()) return;
  const notification = new Notification({
    title: `Mjolnir ${version} is available`,
    body: notes ? firstLines(notes, 3) : `You are on ${app.getVersion()}. It will install when you quit.`,
    silent: true,
  });
  notification.on('click', () => void promptForDownload(version, notes));
  notification.show();
}

async function promptForDownload(version: string, notes = ''): Promise<void> {
  const result = await dialog.showMessageBox({
    type: 'info',
    message: `Mjolnir ${version} is available`,
    // The notes in the dialog rather than behind a button that opens a
    // browser: somebody deciding whether to restart should not have to leave
    // the app to find out what they would get.
    detail: notes
      ? `You are on ${app.getVersion()}.\n\n${firstLines(notes, 12)}\n\nDownloading happens in the background and installs when you quit.`
      : `You are on ${app.getVersion()}. Downloading happens in the background and installs when you quit.`,
    buttons: ['Download', 'All release notes', `Skip ${version}`, 'Not now'],
    defaultId: 0,
    cancelId: 3,
  });
  if (result.response === 0) await updater?.downloadUpdate();
  if (result.response === 1) void shell.openExternal(ENDPOINTS.releases);
  if (result.response === 2) skipped = version;
}

/** Markdown or HTML from a release manifest, as text a dialog can show. */
export function plainNotes(notes: string | null | undefined): string {
  if (!notes) return '';
  return notes
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|h\d)>/gi, '\n')
    .replace(/<li>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/^#+\s*/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function firstLines(text: string, count: number): string {
  const lines = text.split('\n');
  return lines.length <= count ? text : `${lines.slice(0, count).join('\n')}\n…`;
}

let skipped = '';

/** The version the person chose to stop hearing about, for the server to persist. */
export function skippedVersion(): string {
  return skipped;
}

async function promptForInstall(version: string, notes = ''): Promise<void> {
  const result = await dialog.showMessageBox({
    type: 'info',
    message: `Mjolnir ${version} is ready`,
    detail: notes
      ? `${firstLines(notes, 10)}\n\nRestarting takes a few seconds. Port forwards and shells will close.`
      : 'Restarting takes a few seconds. Port forwards and shells will close.',
    buttons: ['Restart now', 'On next quit'],
    defaultId: 1,
    cancelId: 1,
  });
  if (result.response === 0) updater?.quitAndInstall(false, true);
}

export function installNow(): void {
  updater?.quitAndInstall(false, true);
}
