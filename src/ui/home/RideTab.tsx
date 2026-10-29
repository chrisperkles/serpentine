import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { TIMES } from '../../engine/atmosphere.ts';
import { leadInLength } from '../../geo/leadIn.ts';
import type { QueuedRoute } from '../../sim/queue.ts';
import { getActivePlan, type AppSettings, type RideSummary } from '../../sim/storage.ts';
import { adapt } from '../../training/adapt.ts';
import { entryFor, isoDate, templateById } from '../../training/plans.ts';
import type { Workout } from '../../workouts/types.ts';
import { fmtTime, int, km } from '../format.ts';
import { lowBattery } from '../BatteryWarning.tsx';
import { useBattery, useHub } from '../hooks.ts';
import { WorkoutChart } from '../WorkoutChart.tsx';
import {
  CATEGORIES, CATEGORY_LABEL, matchesCategory, Profile, RouteShape, RouteStatsLine, SHOWCASE, useRouteStats, workoutMeta,
  type RideMode, type RouteEntry,
} from './shared.tsx';
import { StravaSegments } from './StravaSegments.tsx';
import { WorkoutDetail, WorkoutList } from './WorkoutLibrary.tsx';

export interface RideTabProps {
  routes: RouteEntry[];
  route: RouteEntry | undefined;
  onRoute: (id: string) => void;
  onImportGpx: (f: File) => void;
  onDrawRoute: () => void;
  onDeleteRoute: (id: string) => void;
  rides: RideSummary[];
  workouts: Workout[];
  mode: RideMode;
  onMode: (m: RideMode) => void;
  workout: Workout | null;
  onWorkout: (id: string) => void;
  settings: AppSettings;
  set: <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => void;
  onStart: () => void;
  onDevices: () => void;
  error: string | null;
  /** Shown above the route (the unfinished-ride card). */
  notice?: ReactNode;
  queue: QueuedRoute[];
  onQueue: (q: QueuedRoute[]) => void;
}

export function RideTab(p: RideTabProps) {
  const [cat, setCat] = useState<string>(() => (p.route?.data.category as string | undefined) ?? 'all');
  const [picker, setPicker] = useState(false);
  const [today, setToday] = useState<string | null>(null);

  // today's session as the plan stands after the rides so far (moved or lighter: training/adapt.ts)
  const { rides, workouts } = p;
  useEffect(() => {
    void getActivePlan().then((stored) => {
      const t = stored ? templateById(stored.templateId) : undefined;
      if (!stored || !t) return setToday(null);
      const day = isoDate(new Date());
      const planRides = rides.map((r) => ({ start: r.start, workoutId: r.workoutId, duration: r.duration, tss: r.tss }));
      const { active } = adapt(stored, t, planRides, day, (id) => workouts.find((w) => w.id === id));
      setToday(entryFor(active, t, day)?.day.workoutId ?? null);
    });
  }, [rides, workouts]);

  const list = p.routes.filter((r) => matchesCategory(r, cat));
  const todayWorkout = today && today !== 'free' ? p.workouts.find((w) => w.id === today) : null;
  const showToday = todayWorkout && !(p.mode === 'workout' && p.workout?.id === todayWorkout.id);

  return (
    <div className="ride-tab">
      <aside className="routes-pane" aria-label="Routes">
        <div className="pane-head">
          <h2>Where to ride</h2>
          <div className="actions">
            <label className="btn ghost small">
              Import GPX
              <input type="file" accept=".gpx" hidden onChange={(e) => e.target.files?.[0] && p.onImportGpx(e.target.files[0])} />
            </label>
            <button className="btn ghost small" onClick={p.onDrawRoute}>
              Draw a route
            </button>
          </div>
        </div>
        <div className="segmented small" role="radiogroup" aria-label="Route type">
          {CATEGORIES.map((c) => (
            <button key={c.id} role="radio" aria-checked={cat === c.id} className={cat === c.id ? 'on' : ''} onClick={() => setCat(c.id)}>
              {c.label}
            </button>
          ))}
        </div>
        {p.error && <p className="error">{p.error}</p>}
        <ol className="route-rows">
          {list.map((r) => {
            const pos = p.queue.findIndex((q) => q.id === r.data.id);
            return (
              <li key={r.data.id} className="has-queue">
                <button className={`route-row ${r.data.id === p.route?.data.id ? 'on' : ''}`} onClick={() => p.onRoute(r.data.id)}>
                  <span className="rr-name">
                    {r.data.name}
                    {SHOWCASE.has(r.data.id) && !r.custom && <span className="rr-tag">Most detailed</span>}
                  </span>
                  <span className="rr-region">{r.data.region ?? (r.data.source === 'drawn' ? 'Drawn route' : 'Imported GPX')}</span>
                  <RouteStatsLine entry={r} />
                  <Profile entry={r} height={30} bins={36} className="rr-profile" />
                </button>
                <button
                  className={`rr-queue ${pos >= 0 ? 'on' : ''}`}
                  aria-pressed={pos >= 0}
                  title={pos >= 0 ? `Number ${pos + 1} in the queue. Click to take it out` : 'Ride this next: it starts by itself at the end of the route before'}
                  aria-label={pos >= 0 ? `Remove ${r.data.name} from the queue` : `Ride ${r.data.name} next`}
                  onClick={() =>
                    p.onQueue(pos >= 0 ? p.queue.filter((q) => q.id !== r.data.id) : [...p.queue, { id: r.data.id, name: r.data.name }])
                  }
                >
                  {pos >= 0 ? pos + 1 : '+'}
                </button>
              </li>
            );
          })}
          {list.length === 0 && (
            <li className="muted small empty-row">
              {cat === 'mine' ? 'No routes of your own yet. Import a GPX or draw one on the map.' : 'No routes in this group.'}
            </li>
          )}
        </ol>
        <p className="hint">Drop a .gpx from Komoot, Strava or Garmin anywhere to ride it.</p>
      </aside>

      <main className="ride-pane">
        {p.notice}
        {p.route && (
          <RouteHero
            entry={p.route}
            rides={p.rides}
            onDelete={p.route.custom ? () => p.onDeleteRoute(p.route!.data.id) : undefined}
            leadIn={p.settings.leadIn}
            onLeadIn={(on) => p.set('leadIn', on)}
          />
        )}

        <section className="how" aria-label="How to ride">
          <div className="pane-head">
            <h2>How to ride</h2>
            {showToday && (
              <button className="today-chip" onClick={() => { p.onMode('workout'); p.onWorkout(todayWorkout!.id); }}>
                Today's plan: <b>{todayWorkout!.name}</b>
              </button>
            )}
          </div>
          <div className="segmented mode" role="radiogroup" aria-label="Ride mode">
            {(
              [
                ['free', 'Free ride'],
                ['workout', 'Workout'],
                ['hold', 'Hold watts'],
              ] as const
            ).map(([id, label]) => (
              <button key={id} role="radio" aria-checked={p.mode === id} className={p.mode === id ? 'on' : ''} onClick={() => p.onMode(id)}>
                {label}
              </button>
            ))}
          </div>
          {p.mode === 'free' && (
            <div className="mode-body">
              <p>
                The real gradient sets the resistance at <b>{Math.round(p.settings.difficulty * 100)} %</b> difficulty
                {p.settings.gears ? ', with 24 virtual gears on your shifters.' : '.'}
              </p>
              <input
                className="mode-slider"
                type="range"
                min={0}
                max={100}
                value={Math.round(p.settings.difficulty * 100)}
                onChange={(e) => p.set('difficulty', Number(e.target.value) / 100)}
                aria-label="Trainer difficulty"
              />
            </div>
          )}
          {p.mode === 'workout' && (
            <div className="mode-body workout-pick">
              {p.workout ? (
                <button className="picked" onClick={() => setPicker(true)}>
                  <span className="w-name">{p.workout.name}</span>
                  <span className="w-meta">{workoutMeta(p.workout)}</span>
                  <WorkoutChart workout={p.workout} height={44} />
                </button>
              ) : (
                <p className="muted">No workout chosen yet.</p>
              )}
              <div className="row">
                <button className="btn ghost small" onClick={() => setPicker(true)}>
                  {p.workout ? 'Change workout' : 'Choose a workout'}
                </button>
                <label className="toggle">
                  <input type="checkbox" checked={p.settings.erg} onChange={(e) => p.set('erg', e.target.checked)} />
                  <span>ERG, the trainer holds the targets</span>
                </label>
              </div>
            </div>
          )}
          {p.mode === 'hold' && (
            <div className="mode-body hold">
              <div className="stepper">
                <button className="btn ghost" onClick={() => p.set('holdWatts', Math.max(40, p.settings.holdWatts - 10))} aria-label="10 watts less">
                  −
                </button>
                <span className="stepper-val">
                  {p.settings.holdWatts}
                  <small>W</small>
                </span>
                <button className="btn ghost" onClick={() => p.set('holdWatts', Math.min(1500, p.settings.holdWatts + 10))} aria-label="10 watts more">
                  +
                </button>
              </div>
              <p className="muted">
                {(p.settings.holdWatts / p.settings.weight).toFixed(1)} W/kg, {Math.round((p.settings.holdWatts / p.settings.ftp) * 100)} % of FTP. Shifters change it by 10 W while riding.
              </p>
            </div>
          )}
        </section>

        <section className="company" aria-label="Riding company and light">
          <div className="company-row">
            <span className="label">Pacers</span>
            <div className="segmented small" role="group" aria-label="Pacers in W/kg">
              {[2.0, 2.5, 3.0, 3.5, 4.0].map((w) => {
                const on = p.settings.bots.includes(w);
                return (
                  <button
                    key={w}
                    aria-pressed={on}
                    className={on ? 'on' : ''}
                    onClick={() => p.set('bots', on ? p.settings.bots.filter((x) => x !== w) : [...p.settings.bots, w].sort())}
                  >
                    {w.toFixed(1)}
                  </button>
                );
              })}
            </div>
            <span className="muted small">W/kg</span>
            <label className="toggle ghost-toggle">
              <input type="checkbox" checked={p.settings.ghost} onChange={(e) => p.set('ghost', e.target.checked)} />
              <span>Race my best as a ghost</span>
            </label>
          </div>
          <div className="company-row">
            <span className="label">Light</span>
            <div className="segmented small" role="radiogroup" aria-label="Time of day">
              {TIMES.map((t) => (
                <button key={t.id} role="radio" aria-checked={p.settings.time === t.id} className={p.settings.time === t.id ? 'on' : ''} onClick={() => p.set('time', t.id)}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {p.route && <StravaSegments routeId={p.route.data.id} preset={p.route.data.source === 'brouter'} settings={p.settings} set={p.set} />}

        <StartBar {...p} />
      </main>

      {picker && (
        <WorkoutPicker
          workouts={p.workouts}
          current={p.workout}
          ftp={p.settings.ftp}
          onPick={(id) => {
            p.onWorkout(id);
            p.onMode('workout');
            setPicker(false);
          }}
          onClose={() => setPicker(false)}
        />
      )}
    </div>
  );
}

function RouteHero({
  entry, rides, onDelete, leadIn, onLeadIn,
}: { entry: RouteEntry; rides: RideSummary[]; onDelete?: () => void; leadIn: boolean; onLeadIn: (on: boolean) => void }) {
  const s = useRouteStats(entry)!;
  const lead = useMemo(() => leadInLength(entry.data), [entry]);
  const mine = useMemo(() => rides.filter((r) => r.routeId === entry.data.id), [rides, entry]);
  // times to the top include the lead-in when it was ridden: compare like with like
  const withLead = leadIn && lead > 0;
  const best = mine.filter((r) => r.summitTime !== null && !!r.leadIn === withLead).sort((a, b) => a.summitTime! - b.summitTime!)[0];
  const cat = entry.data.category ?? (entry.custom ? undefined : 'climb');
  return (
    <section className="hero" aria-label="Selected route">
      <div className="hero-text">
        <h1 className="hero-name">{entry.data.name}</h1>
        <p className="hero-sub">
          <span>{entry.data.region ?? (entry.data.source === 'drawn' ? 'Drawn route' : 'Imported GPX')}</span>
          {cat && <span className="tag">{CATEGORY_LABEL[cat]}</span>}
          {entry.data.loop && <span className="tag">Loop</span>}
          {onDelete && (
            <button className="link danger" onClick={onDelete}>
              Remove route
            </button>
          )}
        </p>
        <dl className="hero-stats">
          <div>
            <dt>Distance</dt>
            <dd>
              {km(s.length)} <small>km</small>
            </dd>
          </div>
          <div>
            <dt>Climbing</dt>
            <dd>
              {int(s.gain)} <small>m</small>
            </dd>
          </div>
          <div>
            <dt>Average</dt>
            <dd>
              {s.avgGrade.toFixed(1)} <small>%</small>
            </dd>
          </div>
          <div>
            <dt>Highest point</dt>
            <dd>
              {int(s.top)} <small>m</small>
            </dd>
          </div>
          <div>
            <dt>{best ? 'Your best' : 'Ridden'}</dt>
            <dd>{best ? fmtTime(best.summitTime!) : mine.length ? `${mine.length}×` : 'Not yet'}</dd>
          </div>
        </dl>
        {lead > 0 && (
          <label className="toggle lead-in-toggle">
            <input type="checkbox" checked={leadIn} onChange={(e) => onLeadIn(e.target.checked)} />
            <span>
              Start with an easy {km(lead)} km lead-in from {entry.data.leadIn!.name} to warm up
            </span>
          </label>
        )}
      </div>
      <RouteShape entry={entry} size={168} />
      <Profile entry={entry} height={120} bins={70} className="hero-profile" />
    </section>
  );
}

function StartBar(p: RideTabProps) {
  const { devices, simulator, shifting } = useHub();
  const trainer = devices.find((d) => d.capabilities.includes('control') && d.protocol !== 'simulator' && d.state === 'connected');
  const ride = devices.find((d) => d.protocol === 'zwift-ride' && d.state === 'connected');
  const ready = !!trainer || simulator;
  const battery = lowBattery(useBattery());
  const what =
    p.mode === 'workout' && p.workout ? p.workout.name : p.mode === 'hold' ? `Holding ${p.settings.holdWatts} W` : 'Free ride';
  const blocked = p.mode === 'workout' && !p.workout;
  return (
    <footer className="start-bar">
      <div className="ready">
        {battery !== null && <span className="warn-line">Battery {battery} %: plug in the charger before you ride. </span>}
        {trainer ? (
          <span className="ok">
            {trainer.name} ready{shifting === 'native' ? ', native shifting' : ''}
            {ride ? ', Zwift Ride connected' : ''}
          </span>
        ) : simulator ? (
          <span className="ok">Keyboard simulator on</span>
        ) : (
          <span className="warn-line">
            No trainer connected.{' '}
            <button className="link" onClick={p.onDevices}>
              Connect devices
            </button>
          </span>
        )}
        {p.queue.length > 0 && (
          <div className="queue-line" aria-label="Queue">
            Then
            {p.queue.map((q) => (
              <span key={q.id} className="queue-chip">
                {q.name}
                <button className="link" aria-label={`Remove ${q.name}`} onClick={() => p.onQueue(p.queue.filter((x) => x.id !== q.id))}>
                  ×
                </button>
              </span>
            ))}
            <span className="small">At the end of each route the next one starts by itself.</span>
          </div>
        )}
      </div>
      <button className="start" disabled={!p.route || blocked} onClick={p.onStart} title={ready ? undefined : 'You can start anyway and connect later'}>
        <span className="start-main">Ride {p.route?.data.name ?? ''}</span>
        <span className="start-sub">{blocked ? 'Choose a workout first' : what}</span>
      </button>
    </footer>
  );
}

function WorkoutPicker({
  workouts, current, ftp, onPick, onClose,
}: { workouts: Workout[]; current: Workout | null; ftp: number; onPick: (id: string) => void; onClose: () => void }) {
  const [sel, setSel] = useState<Workout | null>(current ?? workouts[0] ?? null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal" role="dialog" aria-label="Choose a workout" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="picker">
        <header>
          <h2>Choose a workout</h2>
          <button className="btn ghost small" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="picker-body">
          <WorkoutList workouts={workouts} selectedId={sel?.id ?? null} onSelect={setSel} />
          {sel && (
            <WorkoutDetail workout={sel} ftp={ftp}>
              <button className="btn" onClick={() => onPick(sel.id)}>
                Ride {sel.name}
              </button>
            </WorkoutDetail>
          )}
        </div>
      </div>
    </div>
  );
}
