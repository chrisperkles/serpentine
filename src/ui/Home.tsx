import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { parseGpx } from '../geo/gpx.ts';
import type { RouteData } from '../geo/route.ts';
import {
  deleteCustomRoute, listCustomRoutes, listCustomWorkouts, listRides, saveCustomRoute, saveCustomWorkout,
  type AppSettings, type RideSummary,
} from '../sim/storage.ts';
import { buildRampTest } from '../training/rampTest.ts';
import { LIBRARY, parseZwo } from '../workouts/index.ts';
import type { Workout } from '../workouts/types.ts';
import { hub } from '../devices/index.ts';
import { markWelcomed, needsPick, needsWelcome } from '../sim/profiles.ts';
import type { QueuedRoute } from '../sim/queue.ts';
import { Contours } from './Contours.tsx';
import { History } from './History.tsx';
import { useHub } from './hooks.ts';
import { profileFromCoords } from './profile.ts';
import { Avatar, RiderPicker } from './RiderPicker.tsx';
import { Welcome } from './Welcome.tsx';
import { RideTab } from './home/RideTab.tsx';
import { SettingsTab } from './home/SettingsTab.tsx';
import { DevicesPanel, SHOWCASE, type RideMode, type RouteEntry } from './home/shared.tsx';
import { TrainTab } from './home/TrainTab.tsx';

const RouteBuilder = lazy(() => import('./RouteBuilder.tsx').then((m) => ({ default: m.RouteBuilder })));

export type HomeTab = 'ride' | 'train' | 'history' | 'settings';

export interface StartRequest {
  route: RouteData;
  workout: Workout | null;
  /** Trainer holds these watts for the whole ride (no workout). */
  holdWatts: number | null;
}

function stored<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T) ?? fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* storage blocked */
  }
}

export function Home({
  settings,
  onSettings,
  onStart,
  tab,
  onTab,
  onOpenRide,
  notice,
  queue,
  onQueue,
}: {
  settings: AppSettings;
  onSettings: (s: AppSettings) => void;
  onStart: (r: StartRequest) => void;
  tab: HomeTab;
  onTab: (t: HomeTab) => void;
  onOpenRide: (id: string) => void;
  /** Shown above the route on the Ride tab. */
  notice?: ReactNode;
  /** Routes ridden after the selected one, each starting at the end of the one before. */
  queue: QueuedRoute[];
  onQueue: (q: QueuedRoute[]) => void;
}) {
  const [routes, setRoutes] = useState<RouteEntry[]>([]);
  const [routeId, setRouteId] = useState<string>(() => stored<string>('serpentine.route', 'gaisberg'));
  const [mode, setMode] = useState<RideMode>(() => stored<RideMode>('serpentine.mode', 'free'));
  const [workoutId, setWorkoutId] = useState<string>(() => stored<string>('serpentine.workout', 'sweet-spot-2x20'));
  const [customWorkouts, setCustomWorkouts] = useState<Workout[]>([]);
  const [rides, setRides] = useState<RideSummary[]>([]);
  const [builder, setBuilder] = useState(false);
  const [devicesOpen, setDevicesOpen] = useState(false);
  // "Who's riding?" on start when the household has more than one rider
  const [picker, setPicker] = useState<'required' | 'open' | null>(() => (needsPick() ? 'required' : null));
  // a new install asks for name, weight and FTP before anything else
  const [welcome, setWelcome] = useState(needsWelcome);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const refreshRoutes = async () => {
    const index: { id: string }[] = await (await fetch('/routes/index.json')).json();
    const presets = await Promise.all(
      index.map(async ({ id }) => {
        const data = (await (await fetch(`/routes/${id}.json`)).json()) as RouteData;
        return { data: { ...data, source: 'brouter' as const }, profile: profileFromCoords(data.coords), custom: false };
      }),
    );
    const custom = (await listCustomRoutes()).map((data) => ({ data, profile: profileFromCoords(data.coords), custom: true }));
    const showcase = (r: RouteEntry) => (SHOWCASE.has(r.data.id) ? 0 : 1);
    setRoutes([...custom, ...presets.sort((a, b) => showcase(a) - showcase(b))]);
  };

  useEffect(() => {
    void refreshRoutes();
    void listCustomWorkouts().then(setCustomWorkouts);
    void listRides().then(setRides);
  }, []);

  useEffect(() => store('serpentine.route', routeId), [routeId]);
  useEffect(() => store('serpentine.mode', mode), [mode]);
  useEffect(() => store('serpentine.workout', workoutId), [workoutId]);

  const workouts = useMemo(() => [...customWorkouts, buildRampTest(settings.ftp), ...LIBRARY], [customWorkouts, settings.ftp]);
  const route = routes.find((r) => r.data.id === routeId) ?? routes.find((r) => !r.custom) ?? routes[0];
  const workout = workouts.find((w) => w.id === workoutId) ?? null;
  const set = <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => onSettings({ ...settings, [k]: v });

  const importGpx = async (file: File) => {
    try {
      const data = parseGpx(await file.text(), file.name.replace(/\.gpx$/i, ''));
      await saveCustomRoute(data);
      await refreshRoutes();
      setRouteId(data.id);
      setError(null);
      onTab('ride');
    } catch (e) {
      setError(`${file.name}: ${(e as Error).message}`);
    }
  };

  const importZwo = async (file: File) => {
    try {
      const w = parseZwo(await file.text(), `zwo-${file.name}`);
      await saveCustomWorkout(w);
      setCustomWorkouts(await listCustomWorkouts());
      setWorkoutId(w.id);
      setError(null);
    } catch (e) {
      setError(`${file.name}: ${(e as Error).message}`);
    }
  };

  /** From the plan: the workout, and the routes it suggests (the first to ride, the rest queued after it). */
  const rideWorkout = (id: string, routeIds?: string[]) => {
    if (id === 'free') setMode('free');
    else {
      setWorkoutId(id);
      setMode('workout');
    }
    if (routeIds?.length) {
      setRouteId(routeIds[0]);
      onQueue(routeIds.slice(1).map((r) => ({ id: r, name: routes.find((x) => x.data.id === r)?.data.name ?? r })));
    }
    onTab('ride');
  };
  const routeOptions = useMemo(
    () => routes.map((r) => ({ id: r.data.id, name: r.data.name, category: r.data.category, profile: r.profile })),
    [routes],
  );

  return (
    <div
      className="home"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        for (const f of e.dataTransfer.files) {
          if (/\.gpx$/i.test(f.name)) void importGpx(f);
          else if (/\.zwo$/i.test(f.name)) void importZwo(f);
        }
      }}
    >
      <Contours />
      <TopBar tab={tab} onTab={onTab} onDevices={() => setDevicesOpen(true)} rider={settings} onRider={() => setPicker('open')} />

      <div className={`tab-body tab-${tab}`}>
        {tab === 'ride' && (
          <RideTab
            routes={routes}
            route={route}
            onRoute={setRouteId}
            onImportGpx={(f) => void importGpx(f)}
            onDrawRoute={() => setBuilder(true)}
            onDeleteRoute={async (id) => {
              await deleteCustomRoute(id);
              onQueue(queue.filter((q) => q.id !== id));
              await refreshRoutes();
            }}
            queue={queue}
            onQueue={onQueue}
            rides={rides}
            workouts={workouts}
            mode={mode}
            onMode={setMode}
            workout={workout}
            onWorkout={setWorkoutId}
            settings={settings}
            set={set}
            onStart={() =>
              route &&
              onStart({
                route: route.data,
                workout: mode === 'workout' ? workout : null,
                holdWatts: mode === 'hold' ? settings.holdWatts : null,
              })
            }
            onDevices={() => setDevicesOpen(true)}
            error={error}
            notice={notice}
          />
        )}
        {tab === 'train' && (
          <TrainTab
            workouts={workouts}
            settings={settings}
            rides={rides}
            routes={routeOptions}
            onRideWorkout={rideWorkout}
            onWorkoutsChanged={async (id) => {
              setCustomWorkouts(await listCustomWorkouts());
              if (id) setWorkoutId(id);
            }}
            onImportZwo={(f) => void importZwo(f)}
          />
        )}
        {tab === 'history' && <History embedded onBack={() => onTab('ride')} onOpen={onOpenRide} />}
        {tab === 'settings' && <SettingsTab settings={settings} set={set} />}
      </div>

      {devicesOpen && (
        <div className="drawer-scrim" onClick={(e) => e.target === e.currentTarget && setDevicesOpen(false)}>
          <aside className="drawer" aria-label="Devices">
            <header>
              <h2>Devices</h2>
              <button className="btn ghost small" onClick={() => setDevicesOpen(false)}>
                Done
              </button>
            </header>
            <DevicesPanel />
          </aside>
        </div>
      )}

      {builder && (
        <Suspense fallback={<div className="modal" />}>
          <RouteBuilder
            onClose={() => setBuilder(false)}
            onSave={async (data) => {
              await saveCustomRoute(data);
              await refreshRoutes();
              setRouteId(data.id);
              setBuilder(false);
            }}
          />
        </Suspense>
      )}
      {dragging && <div className="dropzone">Drop to import</div>}
      {welcome && (
        <Welcome
          settings={settings}
          onDone={(s) => {
            onSettings(s);
            markWelcomed();
            setWelcome(false);
            // next: pair the trainer (or switch on the keyboard simulator)
            setDevicesOpen(true);
          }}
        />
      )}
      {picker && (
        <RiderPicker
          required={picker === 'required'}
          onDone={() => {
            // App skipped the silent reconnect until the rider was known
            if (picker === 'required' && !new URLSearchParams(location.search).has('nobt')) void hub.reconnectKnown();
            setPicker(null);
          }}
        />
      )}
    </div>
  );
}

function TopBar({
  tab,
  onTab,
  onDevices,
  rider,
  onRider,
}: {
  tab: HomeTab;
  onTab: (t: HomeTab) => void;
  onDevices: () => void;
  rider: { name: string; kit: string };
  onRider: () => void;
}) {
  const { devices, simulator } = useHub();
  const on = (pred: (d: (typeof devices)[number]) => boolean) => devices.some((d) => pred(d) && d.state === 'connected');
  const chips = [
    { label: 'Trainer', ok: on((d) => d.capabilities.includes('control') && d.protocol !== 'simulator'), alt: simulator ? 'Simulator' : null },
    { label: 'Zwift Ride', ok: on((d) => d.protocol === 'zwift-ride'), alt: null },
    { label: 'Heart rate', ok: on((d) => d.protocol === 'hrs' || (d.capabilities.includes('heartRate') && d.protocol !== 'simulator')), alt: null },
  ];
  const tabs: [HomeTab, string][] = [
    ['ride', 'Ride'],
    ['train', 'Train'],
    ['history', 'History'],
    ['settings', 'Settings'],
  ];
  return (
    <header className="topbar">
      <span className="wordmark">Serpentine</span>
      <nav className="tabs" aria-label="Sections">
        {tabs.map(([id, label]) => (
          <button key={id} className={tab === id ? 'on' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => onTab(id)}>
            {label}
          </button>
        ))}
      </nav>
      <button className="rider-chip" onClick={onRider} aria-label={`Rider: ${rider.name}. Switch rider`}>
        <Avatar p={rider} />
        <span>{rider.name}</span>
      </button>
      <button className="dev-chips" onClick={onDevices} aria-label="Devices">
        {chips.map((c) => (
          <span key={c.label} className={`chip ${c.ok ? 'ok' : c.alt ? 'alt' : ''}`}>
            <i aria-hidden />
            {c.ok ? c.label : c.alt ?? c.label}
          </span>
        ))}
      </button>
    </header>
  );
}
