/**
 * The one seam between the local server and the Electron main process.
 *
 * Some things can only happen in the main process: checking for an update,
 * restarting into it. The renderer is sandboxed and has no preload, which is a
 * deliberate choice, so rather than opening an IPC channel to a page that
 * renders cluster data, the main process hands the server a small object with
 * exactly the operations it is willing to expose. The UI reaches them over the
 * same loopback HTTP it already uses for everything else.
 *
 * When nothing sets a bridge, which is what happens in a browser or in dev,
 * the routes answer honestly that this build does not update itself.
 */
export interface DesktopBridge {
  updateState(): { status: string; version?: string | undefined; percent?: number | undefined; error?: string | undefined; checkedAt?: string | undefined };
  check(interactive: boolean): Promise<unknown>;
  installNow(): void;
  applyPreferences(preferences: { channel: 'stable' | 'beta'; automatic: boolean; checkOnLaunch: boolean; skipped: string }): void;
}

let bridge: DesktopBridge | null = null;

export function setDesktopBridge(next: DesktopBridge | null): void {
  bridge = next;
}

export function desktopBridge(): DesktopBridge | null {
  return bridge;
}
