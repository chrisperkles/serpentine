// Runs before the app's own code in every page load. It restores riders' settings into an empty localStorage
// and mirrors them back to disk, gives the page Chrome's Bluetooth chooser and getDevices() (see
// bluetooth.ts), and shows the update notice.

import { contextBridge, ipcRenderer } from 'electron';

// Strava's sign-in (and Google's or Apple's behind it) opens in this window too. The main process answers
// null there: those pages get neither the riders' settings nor the bridge.
const version = ipcRenderer.sendSync('app:version') as string | null;

// --- settings -------------------------------------------------------------------------------------------
// Device ids belong to one browser, so they are neither restored nor backed up.
const mirrored = (key: string) => key.startsWith('serpentine.') && !key.startsWith('serpentine.devices');

if (version !== null) {
  try {
    const seed = ipcRenderer.sendSync('settings:seed') as Record<string, string> | null;
    if (seed && !Object.keys(localStorage).some(mirrored)) {
      for (const [key, value] of Object.entries(seed)) if (mirrored(key)) localStorage.setItem(key, value);
    }
  } catch {
    /* storage blocked: the app falls back to its defaults */
  }
  setInterval(backup, 15_000);
  window.addEventListener('pagehide', backup);
}

function backup() {
  try {
    const snapshot: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && mirrored(key)) snapshot[key] = localStorage.getItem(key) ?? '';
    }
    ipcRenderer.send('settings:backup', snapshot);
  } catch {
    /* storage blocked */
  }
}

// --- Bluetooth --------------------------------------------------------------------------------------------
if (version !== null) {
  contextBridge.exposeInMainWorld('serpentineApp', {
    version,
    btPicked: (id: string, name: string, options: string) => ipcRenderer.send('bt:picked', id, name, options),
    btReconnect: (ids: string[]) => ipcRenderer.invoke('bt:reconnect', ids) as Promise<string[]>,
    btCancel: () => ipcRenderer.invoke('bt:cancel') as Promise<void>,
    btMine: (ids: string[]) => ipcRenderer.send('bt:mine', ids),
    btLog: (line: string) => ipcRenderer.send('bt:log', String(line)),
    // invite links (serpentine://join/<CODE>): one that started the app, and those that come while it runs
    takeInvite: () => ipcRenderer.sendSync('invite:take') as string | null,
    onInvite: (fn: (code: string) => void) => {
      ipcRenderer.on('invite', (_e, code: string) => fn(String(code)));
    },
  });
  contextBridge.executeInMainWorld({ func: installBluetooth });
}

/** Runs in the page's own world (serialised: it may only use what it defines itself). */
function installBluetooth() {
  type Device = BluetoothDevice;
  const bt = (navigator as Navigator & { bluetooth?: Bluetooth & { getDevices?: () => Promise<Device[]> } }).bluetooth;
  const bridge = (window as unknown as {
    serpentineApp?: {
      btPicked: (id: string, name: string, options: string) => void;
      btReconnect: (ids: string[]) => Promise<string[]>;
      btCancel: () => Promise<void>;
      btMine: (ids: string[]) => void;
    };
  }).serpentineApp;
  if (!bt || !bridge) return;
  const request = bt.requestDevice.bind(bt);
  const found = new Map<string, Device>();

  /** The active rider's saved device ids, under the keys src/devices uses. */
  const savedIds = (): string[] => {
    try {
      const profile = JSON.parse(localStorage.getItem('serpentine.profile') ?? '"main"') as string;
      const key = profile === 'main' ? 'serpentine.devices' : `serpentine.devices.${profile}`;
      const ids = Object.values(JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>);
      return [...new Set(ids.filter((v): v is string => typeof v === 'string'))];
    } catch {
      return [];
    }
  };

  bt.requestDevice = async (options?: RequestDeviceOptions) => {
    // the chooser tags this rider's devices, and a silent search for them makes way
    bridge.btMine(savedIds());
    await bridge.btCancel();
    const device = await request(options);
    bridge.btPicked(device.id, device.name ?? '', JSON.stringify(options ?? {}));
    return device;
  };

  // Called by the main process with a lent user gesture, once per remembered device. The device keeps the id
  // the app saved for it, so the app's own reconnect finds it.
  (window as unknown as { __serpentineFind: (id: string, options: RequestDeviceOptions) => Promise<boolean> }).__serpentineFind =
    async (id, options) => {
      try {
        const device = await request(options);
        Object.defineProperty(device, 'id', { value: id, configurable: true });
        found.set(id, device);
        return true;
      } catch {
        return false;
      }
    };

  if (typeof bt.getDevices !== 'function') {
    bt.getDevices = async () => {
      const ids = savedIds();
      const missing = ids.filter((id) => !found.has(id));
      if (missing.length) await bridge.btReconnect(missing);
      return ids.flatMap((id) => found.get(id) ?? []);
    };
  }
}

// --- overlays: the device chooser and the update notice ----------------------------------------------------
const STYLE = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: 'Barlow', system-ui, sans-serif; }
  .scrim { position: fixed; inset: 0; z-index: 2147483647; display: grid; place-items: center;
    background: rgba(6, 9, 14, 0.55); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
  .panel { width: min(440px, calc(100vw - 32px)); max-height: min(560px, calc(100vh - 64px)); display: flex;
    flex-direction: column; gap: 14px; padding: 22px; border-radius: 18px; color: #f4efe6;
    background: rgba(16, 21, 30, 0.94); border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5); }
  h2 { margin: 0; font: 600 22px/1.1 'Barlow Condensed', 'Barlow', system-ui, sans-serif; letter-spacing: 0.02em;
    text-transform: uppercase; }
  .status { display: flex; align-items: center; gap: 8px; color: rgba(244, 239, 230, 0.65); font-size: 14px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #e8442e; animation: pulse 1.2s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: 0.25; transform: scale(0.7); } }
  .list { display: flex; flex-direction: column; gap: 6px; overflow-y: auto; min-height: 48px; }
  .device { all: unset; display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: 12px 14px; border-radius: 12px; cursor: pointer; font-size: 16px; font-weight: 500;
    background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.06); }
  .device:hover, .device:focus-visible { background: rgba(232, 68, 46, 0.18); border-color: rgba(232, 68, 46, 0.6); }
  .tag { font-size: 12px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: #ffb15c; }
  .hint { margin: 0; font-size: 13px; line-height: 1.4; color: rgba(244, 239, 230, 0.5); }
  .actions { display: flex; justify-content: flex-end; }
  .button { all: unset; cursor: pointer; padding: 9px 16px; border-radius: 10px; font-size: 14px; font-weight: 600;
    color: #f4efe6; background: rgba(255, 255, 255, 0.08); }
  .button:hover, .button:focus-visible { background: rgba(255, 255, 255, 0.14); }
  .button.primary { background: #e8442e; }
  .button.primary:hover, .button.primary:focus-visible { background: #f05a40; }
  .toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 2147483646;
    display: flex; align-items: center; gap: 14px; padding: 12px 12px 12px 18px; border-radius: 14px;
    color: #f4efe6; font-size: 15px; background: rgba(16, 21, 30, 0.94); border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45); }
  .toast small { color: rgba(244, 239, 230, 0.6); font-size: 13px; }
  .lead { margin: 0; font-size: 15px; line-height: 1.45; color: rgba(244, 239, 230, 0.75); }
  .progress { height: 6px; border-radius: 3px; overflow: hidden; background: rgba(255, 255, 255, 0.08); }
  .progress i { display: block; height: 100%; background: linear-gradient(90deg, #e8442e, #ffb15c);
    transition: width 0.3s ease-out; }
`;

let root: ShadowRoot | null = null;
function overlayRoot(): ShadowRoot {
  if (root?.host.isConnected) return root;
  const host = document.createElement('serpentine-app-overlay');
  root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = STYLE;
  root.append(style);
  document.documentElement.append(host);
  return root;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

let chooser: { scrim: HTMLElement; list: HTMLElement; status: HTMLElement } | null = null;

function closeChooser() {
  chooser?.scrim.remove();
  chooser = null;
  window.removeEventListener('keydown', onKey, true);
}

function onKey(e: KeyboardEvent) {
  // the app uses Esc and the number keys during a ride: while the chooser is up, keys are its own
  e.stopPropagation();
  if (e.key === 'Escape') {
    e.preventDefault();
    ipcRenderer.send('bt:choose', '');
  }
}

ipcRenderer.on('bt:open', () => {
  closeChooser();
  const scrim = el('div', 'scrim');
  const panel = el('div', 'panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Choose a Bluetooth device');
  const status = el('div', 'status');
  status.append(el('span', 'dot'), el('span', '', 'Searching nearby…'));
  const list = el('div', 'list');
  const hint = el('p', 'hint', 'Not listed? Pedal to wake the trainer, and quit Zwift and Zwift Companion: a trainer talks to one app at a time.');
  const actions = el('div', 'actions');
  const cancel = el('button', 'button', 'Cancel');
  cancel.addEventListener('click', () => ipcRenderer.send('bt:choose', ''));
  actions.append(cancel);
  panel.append(el('h2', '', 'Choose a device'), status, list, hint, actions);
  scrim.append(panel);
  scrim.addEventListener('click', (e) => e.target === scrim && ipcRenderer.send('bt:choose', ''));
  overlayRoot().append(scrim);
  chooser = { scrim, list, status };
  window.addEventListener('keydown', onKey, true);
  cancel.focus();
});

ipcRenderer.on('bt:list', (_e, devices: { id: string; name: string; lastUsed: boolean }[]) => {
  if (!chooser) return;
  const { list } = chooser;
  // keep the row under the pointer where it is: only rebuild when the list really changed
  const sig = devices.map((d) => d.id).join('|');
  if (list.dataset.sig === sig) return;
  list.dataset.sig = sig;
  list.replaceChildren(
    ...devices.map((d) => {
      const row = el('button', 'device');
      row.append(el('span', '', d.name));
      if (d.lastUsed) row.append(el('span', 'tag', 'Last used'));
      row.addEventListener('click', () => ipcRenderer.send('bt:choose', d.id));
      return row;
    }),
  );
});

ipcRenderer.on('bt:close', closeChooser);

// A new version found at start installs before the first ride; the main process restarts the app when it's in.
let installer: { scrim: HTMLElement; bar: HTMLElement; status: HTMLElement } | null = null;
ipcRenderer.on('update:installing', (_e, state: { version: string; percent: number } | null) => {
  if (!state) {
    installer?.scrim.remove();
    installer = null;
    return;
  }
  const show = () => {
    if (!installer) {
      const scrim = el('div', 'scrim');
      const panel = el('div', 'panel');
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-label', 'Updating Serpentine');
      const lead = el('p', 'lead', `Serpentine ${state.version} is here. It downloads now and Serpentine restarts by itself.`);
      const progress = el('div', 'progress');
      const bar = el('i', '');
      progress.append(bar);
      const status = el('div', 'status');
      const actions = el('div', 'actions');
      const skip = el('button', 'button', 'Skip, update later');
      skip.addEventListener('click', () => ipcRenderer.send('update:skip'));
      actions.append(skip);
      panel.append(el('h2', '', 'Updating Serpentine'), lead, progress, status, actions);
      scrim.append(panel);
      overlayRoot().append(scrim);
      installer = { scrim, bar, status };
    }
    installer.bar.style.width = `${Math.max(2, Math.min(100, state.percent))}%`;
    installer.status.textContent = state.percent >= 100 ? 'Installing…' : `${Math.round(state.percent)} %`;
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show, { once: true });
  else show();
});

let toast: HTMLElement | null = null;
ipcRenderer.on('update:ready', (_e, version: string) => {
  const show = () => {
    // not over the ride's HUD: the notice waits until the ride is over
    if (document.querySelector('.hud')) return void setTimeout(show, 5000);
    toast?.remove();
    toast = el('div', 'toast');
    const text = el('div', '');
    text.append(document.createTextNode(`Serpentine ${version} is ready. `), el('small', '', 'It installs when you quit.'));
    const restart = el('button', 'button primary', 'Restart now');
    restart.addEventListener('click', () => ipcRenderer.send('update:install'));
    const later = el('button', 'button', 'Later');
    later.addEventListener('click', () => {
      toast?.remove();
      toast = null;
    });
    toast.append(text, restart, later);
    overlayRoot().append(toast);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show, { once: true });
  else show();
});
