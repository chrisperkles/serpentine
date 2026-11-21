// Serpentine as a Mac app. Electron's Chromium runs the same build that runs in Chrome (the renderer is tuned
// for it), a server in this process serves it with the rides API, and electron-updater keeps it current.
// Riders' settings live in the browser's localStorage; they are mirrored to the data folder so a new install
// (or the first start after the Chrome version) begins with them.

import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { cpus, homedir, totalmem } from 'node:os';
import { join } from 'node:path';
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, screen, session, shell } from 'electron';
import { attachBluetooth } from './bluetooth.ts';
import { fromApp, isAppUrl, ORIGIN, PORT } from './origin.ts';
import { startServer } from './server.ts';
import { attachUpdates } from './updates.ts';

const DATA = process.env.SERPENTINE_DATA ?? join(homedir(), 'Documents', 'Serpentine');
const SETTINGS = join(DATA, 'data', 'local-settings.json');

if (process.env.SERPENTINE_USER_DATA) app.setPath('userData', process.env.SERPENTINE_USER_DATA);

// Invite links: the relay's page opens serpentine://join/<CODE>. macOS hands it over with open-url, on a cold
// start before the window exists; it waits here until the page takes it (invite:take), or goes straight to the
// page when it is already open.
let pendingInvite: string | null = null;
let inviteTarget: BrowserWindow | null = null;
function openInvite(url: string) {
  const code = /^serpentine:\/\/join\/([A-Za-z0-9]{5})(?:[/?#]|$)/i.exec(url)?.[1]?.toUpperCase();
  if (!code) return;
  const w = inviteTarget;
  if (w && !w.isDestroyed() && isAppUrl(w.webContents.getURL())) {
    w.webContents.send('invite', code);
    if (w.isMinimized()) w.restore();
    w.focus();
  } else pendingInvite = code;
}
app.on('open-url', (e, url) => {
  e.preventDefault();
  openInvite(url);
});
if (process.env.SERPENTINE_OPEN_URL) openInvite(process.env.SERPENTINE_OPEN_URL);
// a trainer keeps riding while the window is behind another app
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

function log(...parts: unknown[]) {
  const line = `${new Date().toISOString()} ${parts.map((p) => (p instanceof Error ? p.stack : typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}\n`;
  try {
    mkdirSync(app.getPath('logs'), { recursive: true });
    appendFileSync(join(app.getPath('logs'), 'main.log'), line);
  } catch {
    /* logging must never stop the app */
  }
}

/** Pages Serpentine may open in its own window: itself and Strava's sign-in. */
function staysInApp(url: string): boolean {
  try {
    if (isAppUrl(url)) return true;
    const u = new URL(url);
    const host = u.hostname;
    return (
      u.protocol === 'https:' &&
      (host === 'strava.com' ||
        host.endsWith('.strava.com') ||
        host === 'accounts.google.com' ||
        host === 'appleid.apple.com' ||
        host.endsWith('.facebook.com'))
    );
  } catch {
    return false;
  }
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

function writeJson(file: string, value: unknown) {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 1));
  renameSync(`${file}.tmp`, file);
}

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized?: boolean;
}

function createWindow(): BrowserWindow {
  const boundsFile = join(app.getPath('userData'), 'window.json');
  const saved = readJson<Bounds>(boundsFile);
  const area = screen.getPrimaryDisplay().workArea;
  const visible = saved && screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return saved.x < a.x + a.width && saved.x + saved.width > a.x && saved.y < a.y + a.height && saved.y + saved.height > a.y;
  });
  const win = new BrowserWindow({
    ...(visible ? saved : { width: Math.min(1600, area.width), height: Math.min(1000, area.height) }),
    minWidth: 960,
    minHeight: 600,
    title: 'Serpentine',
    backgroundColor: '#0C121C',
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  if (visible && saved.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.on('close', () => {
    try {
      writeJson(boundsFile, { ...win.getNormalBounds(), maximized: win.isMaximized() });
    } catch {
      /* not worth stopping a quit for */
    }
  });

  const wc = win.webContents;
  // The ride screen asks before the page goes away; Chromium leaves that question to the app.
  wc.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      message: 'Leave the ride?',
      detail: 'Serpentine keeps it: on the next start, Home offers to carry on, save it or discard it.',
      buttons: ['Keep Riding', 'Leave'],
      defaultId: 0,
      cancelId: 0,
    });
    if (choice === 1) event.preventDefault();
  });
  wc.on('will-navigate', (event, url) => {
    if (staysInApp(url)) return;
    event.preventDefault();
    if (/^https?:/.test(url)) void shell.openExternal(url);
  });
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('render-process-gone', (_e, details) => log('renderer gone', details.reason, details.exitCode));
  return win;
}

/** What a friend pastes into a message when something doesn't work: versions, GPU, devices and the log's end. */
function diagnostics(): string {
  let tail = '(no log yet)';
  try {
    tail = readFileSync(join(app.getPath('logs'), 'main.log'), 'utf8').trimEnd().split('\n').slice(-80).join('\n');
  } catch {
    /* first start */
  }
  const devices = Object.values(readJson<Record<string, { name: string }>>(join(app.getPath('userData'), 'bluetooth.json')) ?? {});
  const gpu = app.getGPUFeatureStatus();
  const d = screen.getPrimaryDisplay();
  return [
    `Serpentine ${app.getVersion()} (${process.arch}), macOS ${process.getSystemVersion()}`,
    `${cpus()[0]?.model ?? 'Unknown chip'}, ${Math.round(totalmem() / 2 ** 30)} GB`,
    `Electron ${process.versions.electron}, Chromium ${process.versions.chrome}, WebGL ${gpu.webgl}, GPU compositing ${gpu.gpu_compositing}`,
    `Display ${d.size.width}×${d.size.height} at ${d.scaleFactor}x`,
    `Saved devices: ${devices.map((k) => k.name).join(', ') || 'none'}`,
    '',
    tail,
  ].join('\n');
}

function buildMenu(checkForUpdates: () => Promise<void>) {
  const rides = join(DATA, 'rides');
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Serpentine',
        submenu: [
          { role: 'about' },
          { label: 'Check for Updates…', click: () => void checkForUpdates() },
          { type: 'separator' },
          {
            label: 'Show Rides Folder',
            click: () => {
              mkdirSync(rides, { recursive: true });
              void shell.openPath(rides);
            },
          },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [
          { role: 'togglefullscreen' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'reload' },
          { role: 'toggleDevTools', accelerator: 'Alt+Command+I' },
        ],
      },
      { role: 'windowMenu' },
      {
        role: 'help',
        submenu: [
          {
            label: 'Copy Diagnostics',
            click: async () => {
              await clipboard.writeText(diagnostics());
              await dialog.showMessageBox({
                message: 'Diagnostics copied.',
                detail:
                  'Paste them into a message to whoever helps you with Serpentine. They hold the app and macOS versions, your saved Bluetooth devices and the last lines of the log.',
              });
            },
          },
          { label: 'Show Log in Finder', click: () => shell.showItemInFolder(join(app.getPath('logs'), 'main.log')) },
          { type: 'separator' },
          { label: 'Serpentine on GitHub', click: () => void shell.openExternal('https://github.com/chrisperkles/serpentine') },
        ],
      },
    ]),
  );
}

function attachSettings() {
  // read once by the preload before the app's own code runs; empty storage is then filled from it
  // only for the app's own page: a sign-in page in the same window must not read or write the riders
  ipcMain.on('settings:seed', (e) => {
    e.returnValue = fromApp(e) ? readJson<Record<string, string>>(SETTINGS) : null;
  });
  let last = '';
  ipcMain.on('settings:backup', (e, snapshot: Record<string, string>) => {
    if (!fromApp(e)) return;
    // the same filter as the preload's, so nothing else can end up in the file
    snapshot = Object.fromEntries(
      Object.entries(snapshot).filter(([k, v]) => k.startsWith('serpentine.') && !k.startsWith('serpentine.devices') && typeof v === 'string'),
    );
    const text = JSON.stringify(snapshot);
    if (text === last || !Object.keys(snapshot).length) return;
    last = text;
    try {
      writeJson(SETTINGS, snapshot);
    } catch (err) {
      log('settings backup failed', err);
    }
  });
  ipcMain.on('invite:take', (e) => {
    e.returnValue = fromApp(e) ? pendingInvite : null;
    if (fromApp(e)) pendingInvite = null;
  });
  // null tells the preload it is on someone else's page
  ipcMain.on('app:version', (e) => {
    e.returnValue = fromApp(e) ? app.getVersion() : null;
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win: BrowserWindow | null = null;
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.on('window-all-closed', () => app.quit());

  void app.whenReady().then(async () => {
    log('start', app.getVersion(), ORIGIN);
    app.setAboutPanelOptions({
      applicationName: 'Serpentine',
      applicationVersion: app.getVersion(),
      copyright: 'MIT License · github.com/chrisperkles/serpentine',
    });
    const allowed = new Set(['screen-wake-lock', 'fullscreen', 'clipboard-sanitized-write', 'persistent-storage', 'pointerLock']);
    session.defaultSession.setPermissionRequestHandler((_wc, permission, done) => done(allowed.has(permission)));

    try {
      await startServer(join(app.getAppPath(), 'dist'), PORT);
    } catch (e) {
      log('server failed', e);
      dialog.showErrorBox(
        'Serpentine cannot start',
        `Port ${PORT} is already in use. Quit whatever uses it (another copy of Serpentine?) and open Serpentine again.\n\n${String(e)}`,
      );
      app.quit();
      return;
    }

    attachSettings();
    // the packaged app's Info.plist claims serpentine:// (electron-builder.yml); a dev run must not take it over
    if (app.isPackaged && !app.isDefaultProtocolClient('serpentine')) app.setAsDefaultProtocolClient('serpentine');
    win = createWindow();
    inviteTarget = win;
    attachBluetooth(win, log);
    buildMenu(attachUpdates(win, log));
    await win.loadURL(`${ORIGIN}/`);
  });
}
