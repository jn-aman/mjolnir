import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserWindow as BrowserWindowType, MenuItemConstructorOptions } from 'electron';
import { ENDPOINTS } from '@mjolnir/endpoints';
import { logger } from '@mjolnir/logger';
import { setDesktopBridge, startServer, type ServerHandle } from '@mjolnir/server';
import { check, initUpdater, installNow, setPreferences, updateState } from './updater.ts';

const log = logger.child('desktop');
const here = dirname(fileURLToPath(import.meta.url));

// Electron's main-process module is CommonJS, and its exports are defined
// lazily, so ESM named imports do not bind. Requiring it explicitly is the
// supported way in, and it keeps the types.
const electron = createRequire(import.meta.url)('electron') as typeof import('electron');
const { app, BrowserWindow, Menu, Tray, clipboard, dialog, nativeImage, nativeTheme, shell } = electron;

/**
 * The desktop shell.
 *
 * The app is the local server plus a window pointed at it. The server binds
 * to 127.0.0.1 on a port the OS picks, so two copies of Mjolnir never fight
 * over one port and nothing is reachable from the network. The renderer gets
 * no Node integration and no remote content: everything it loads comes from
 * the server this process started.
 */
let server: ServerHandle | null = null;
let windows: BrowserWindowType[] = [];
let tray: import('electron').Tray | null = null;

const isMac = process.platform === 'darwin';

function createWindow(): BrowserWindowType {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    // The traffic lights sit inside our own title bar; the web app leaves
    // room for them when it sees Electron in the user agent.
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    ...(isMac ? { trafficLightPosition: { x: 16, y: 15 } } : {}),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0d14' : '#fbfcfe',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Nothing is loaded from the internet, so this stays on.
      webSecurity: true,
    },
  });

  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    windows = windows.filter((entry) => entry !== window);
  });

  // A link to anywhere else opens in the browser, never in the app frame.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url) && !url.startsWith(origin())) {
      void shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(origin())) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  void window.loadURL(origin());
  windows.push(window);
  return window;
}

function origin(): string {
  return `http://127.0.0.1:${server?.port ?? 0}`;
}

/** Sends a hash route to the focused window, for menu items and the tray. */
function go(route: string): void {
  const window = BrowserWindow.getFocusedWindow() ?? windows[0] ?? createWindow();
  window.show();
  window.focus();
  void window.webContents.executeJavaScript(`location.hash = ${JSON.stringify(route)}`);
}

function press(key: string): void {
  const window = BrowserWindow.getFocusedWindow() ?? windows[0];
  window?.webContents.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers: [isMac ? 'meta' : 'control'] });
  window?.webContents.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers: [isMac ? 'meta' : 'control'] });
}

function buildMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: 'Mjolnir',
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { label: 'Settings…', accelerator: 'Cmd+,', click: () => go('#/nav=page:app-settings') },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ] as MenuItemConstructorOptions[])
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'New window', accelerator: 'CmdOrCtrl+N', click: () => createWindow() },
        { type: 'separator' },
        ...(isMac ? ([{ role: 'close' }] as MenuItemConstructorOptions[]) : ([{ label: 'Settings…', accelerator: 'Ctrl+,', click: () => go('#/nav=page:app-settings') }, { role: 'quit' }] as MenuItemConstructorOptions[])),
      ],
    },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    {
      label: 'Go',
      submenu: [
        { label: 'Search everything…', accelerator: 'CmdOrCtrl+K', click: () => press('K') },
        { type: 'separator' },
        { label: 'Cluster overview', click: () => go('#/nav=page:overview') },
        { label: 'Pods', click: () => go('#/nav=resource:Pod') },
        { label: 'Deployments', click: () => go('#/nav=resource:Deployment') },
        { label: 'Nodes', click: () => go('#/nav=resource:Node') },
        { type: 'separator' },
        { label: 'Containers', click: () => go('#/nav=workspace:docker:containers') },
        { label: 'Object storage', click: () => go('#/nav=workspace:storage:buckets') },
        { label: 'Helm releases', click: () => go('#/nav=tool:helm') },
        { label: 'Port forwards', click: () => go('#/nav=tool:portforward') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle navigation', accelerator: 'CmdOrCtrl+B', click: () => press('B') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, ...(isMac ? ([{ type: 'separator' }, { role: 'front' }] as MenuItemConstructorOptions[]) : [])] },
    {
      role: 'help',
      submenu: [
        { label: 'mjolnir.sh', click: () => void shell.openExternal('https://mjolnir.sh') },
        { label: 'Source on GitHub', click: () => void shell.openExternal('https://github.com/jn-aman/mjolnir') },
        { label: 'Copy the local API address', click: () => clipboard.writeText(origin()) },
        { type: 'separator' },
        { label: 'Check for updates…', click: () => void check(true) },
        { label: 'Release notes', click: () => void shell.openExternal(ENDPOINTS.releases) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** A menu bar extra: the app is one click away even with no window open. */
function buildTray(): void {
  const icon = nativeImage.createFromPath(join(here, '..', 'build', 'trayTemplate.png'));
  if (icon.isEmpty()) return;
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('Mjolnir');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Mjolnir', click: () => (windows[0] ? (windows[0].show(), windows[0].focus()) : createWindow()) },
      { type: 'separator' },
      { label: 'Cluster overview', click: () => go('#/nav=page:overview') },
      { label: 'Containers', click: () => go('#/nav=workspace:docker:containers') },
      { label: 'Port forwards', click: () => go('#/nav=tool:portforward') },
      { type: 'separator' },
      { label: 'Settings…', click: () => go('#/nav=page:app-settings') },
      { label: 'Quit Mjolnir', click: () => app.quit() },
    ]),
  );
}

// One instance owns the server and the kubeconfig watches; a second launch
// raises the first one's window instead of starting a rival copy.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const window = windows[0] ?? createWindow();
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  app.whenReady().then(async () => {
    try {
      // Packaged, the client lives in Resources beside the asar; in a checkout
      // the server's own default (apps/web/dist) is already right.
      if (app.isPackaged) process.env['MJOLNIR_WEB_DIST'] = join(process.resourcesPath, 'web');
      server = await startServer(0);
      log.info('desktop server started', { port: server.port });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('could not start the local server', { error: message });
      dialog.showErrorBox('Mjolnir could not start', `The local server did not start: ${message}`);
      app.quit();
      return;
    }
    buildMenu();
    buildTray();
    createWindow();
    startUpdates();
    reportCrashesToServer();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    // On macOS the app stays in the menu bar; elsewhere closing the last
    // window is quitting.
    if (!isMac) app.quit();
  });

  app.on('before-quit', () => {
    void server?.close();
    tray?.destroy();
  });
}

/**
 * The updater reads its preferences from the same settings file the UI writes,
 * through the local server, so there is one answer to "does this update itself"
 * rather than one per process.
 */
async function startUpdates(): Promise<void> {
  try {
    const response = await fetch(`${origin()}/api/settings`);
    const payload = (await response.json()) as { settings?: { updates?: { channel?: 'stable' | 'beta'; automatic?: boolean; checkOnLaunch?: boolean; skipped?: string } } };
    const updates = payload.settings?.updates ?? {};
    setDesktopBridge({
      updateState,
      check,
      installNow,
      applyPreferences: setPreferences,
    });
    initUpdater(
      {
        channel: updates.channel ?? 'stable',
        automatic: updates.automatic ?? true,
        checkOnLaunch: updates.checkOnLaunch ?? true,
        skipped: updates.skipped ?? '',
      },
      (next) => {
        for (const window of windows) window.webContents.send?.('mjolnir:update', next);
      },
    );
  } catch (error) {
    log.warn('update preferences could not be read', { error: String(error) });
  }
}

/**
 * A crash in the main process is the one crash the renderer cannot report, so
 * it goes to the local server's queue, which sends it only if the person said
 * yes and only after stripping paths.
 */
function reportCrashesToServer(): void {
  const send = (kind: 'main', error: Error): void => {
    void fetch(`${origin()}/api/telemetry/crash`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind, message: error.message, stack: error.stack ?? '' }),
    }).catch(() => {});
  };
  process.on('uncaughtException', (error) => {
    log.error('uncaught exception in the main process', { error: error.message });
    send('main', error);
  });
  process.on('unhandledRejection', (reason) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    log.error('unhandled rejection in the main process', { error: error.message });
    send('main', error);
  });
}
