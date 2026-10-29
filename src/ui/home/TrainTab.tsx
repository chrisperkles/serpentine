import { useMemo, useState } from 'react';
import type { AppSettings, RideSummary } from '../../sim/storage.ts';
import type { RouteOption } from '../../training/routeFit.ts';
import { RAMP_TEST_ID } from '../../training/rampTest.ts';
import { toZwo } from '../../workouts/zwo.ts';
import type { Workout } from '../../workouts/types.ts';
import { download } from '../download.ts';
import { PlanPanel } from '../PlanPanel.tsx';
import { WorkoutBuilder } from '../WorkoutBuilder.tsx';
import { WorkoutDetail, WorkoutList } from './WorkoutLibrary.tsx';

export function TrainTab({
  workouts,
  settings,
  rides,
  routes,
  onRideWorkout,
  onWorkoutsChanged,
  onImportZwo,
}: {
  workouts: Workout[];
  settings: AppSettings;
  rides: RideSummary[];
  routes: RouteOption[];
  /** A workout, and the routes to ride it on when the plan suggests them (the first one, then the queue). */
  onRideWorkout: (id: string, routeIds?: string[]) => void;
  onWorkoutsChanged: (select?: string) => void;
  onImportZwo: (f: File) => void;
}) {
  const [sel, setSel] = useState<Workout | null>(workouts.find((w) => w.id !== RAMP_TEST_ID) ?? null);
  const [builder, setBuilder] = useState<{ initial?: Workout } | null>(null);
  const ramp = workouts.find((w) => w.id === RAMP_TEST_ID);
  const planRides = useMemo(() => rides.map((r) => ({ start: r.start, workoutId: r.workoutId, duration: r.duration, tss: r.tss })), [rides]);
  return (
    <div className="train-tab">
      <div className="train-plan">
        <PlanPanel
          ftp={settings.ftp}
          rides={planRides}
          routes={routes}
          mass={settings.weight + settings.bikeWeight}
          onPickWorkout={onRideWorkout}
        />
        <section className="ftp-box">
          <h2>Your FTP</h2>
          <p className="ftp-val">
            {settings.ftp} <small>W</small> <span className="muted">{(settings.ftp / settings.weight).toFixed(1)} W/kg</span>
          </p>
          <p className="muted small">All workout targets scale with it. A ramp test takes about 20 minutes and sets it for you.</p>
          {ramp && (
            <button className="btn ghost small" onClick={() => onRideWorkout(ramp.id)}>
              Take the ramp test
            </button>
          )}
        </section>
      </div>
      <section className="train-library" aria-label="Workout library">
        <div className="pane-head">
          <h2>Workouts</h2>
          <div className="actions">
            <button className="btn ghost small" onClick={() => setBuilder({})}>
              Build a workout
            </button>
            <label className="btn ghost small">
              Import .zwo
              <input type="file" accept=".zwo" hidden onChange={(e) => e.target.files?.[0] && onImportZwo(e.target.files[0])} />
            </label>
          </div>
        </div>
        <div className="library-body">
          <WorkoutList workouts={workouts} selectedId={sel?.id ?? null} onSelect={setSel} />
          {sel && (
            <WorkoutDetail workout={sel} ftp={settings.ftp}>
              <div className="row">
                <button className="btn" onClick={() => onRideWorkout(sel.id)}>
                  Ride this workout
                </button>
                {sel.id !== RAMP_TEST_ID && (
                  <button className="btn ghost small" onClick={() => setBuilder({ initial: sel })}>
                    {sel.source === 'builtin' ? 'Edit a copy' : 'Edit'}
                  </button>
                )}
                <button className="link" onClick={() => download(toZwo(sel), `${sel.id}.zwo`, 'application/xml')}>
                  Export .zwo
                </button>
              </div>
            </WorkoutDetail>
          )}
        </div>
      </section>
      {builder && (
        <WorkoutBuilder
          ftp={settings.ftp}
          initial={builder.initial}
          onClose={() => setBuilder(null)}
          onSaved={(w) => {
            onWorkoutsChanged(w.id);
            setSel(w);
          }}
        />
      )}
    </div>
  );
}
