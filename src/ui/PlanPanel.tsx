import { useEffect, useMemo, useState } from 'react';
import { getActivePlan, listCustomWorkouts, saveActivePlan } from '../sim/storage.ts';
import { adapt, sameChanges, TIRED } from '../training/adapt.ts';
import {
  PLAN_TEMPLATES, addDays, completion, entryFor, isoDate, mondayOf, nextMonday, planForGoal, schedule, templateById, weekIndex,
  type ActivePlan, type PlanRide, type PlanTemplate,
} from '../training/plans.ts';
import { resolveWorkout } from '../training/resolve.ts';
import { averagePower, pickRoutes, type RouteOption } from '../training/routeFit.ts';
import type { Workout } from '../workouts/types.ts';
import { DAY_NAMES, PlanCalendar, shortDate } from './PlanCalendar.tsx';
import { WorkoutChart } from './WorkoutChart.tsx';

interface Props {
  ftp: number;
  /** A workout id ('free' for a free climb) and, when the plan suggests them, the routes to ride it on. */
  onPickWorkout: (workoutId: string, routeIds?: string[]) => void;
  rides: PlanRide[];
  routes: RouteOption[];
  /** Rider and bike, kg: how long a route takes at the session's power. */
  mass: number;
}

const TERRAIN_HINT = { climb: 'Best on a climbing route.', flat: 'Best on a flat route.', any: '' } as const;

const minutes = (s: number) => (s >= 5400 ? `${Math.floor(s / 3600)} h ${String(Math.round((s % 3600) / 60)).padStart(2, '0')}` : `${Math.round(s / 60)} min`);

const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);

export function PlanPanel({ ftp, onPickWorkout, rides, routes, mass }: Props) {
  const [stored, setStored] = useState<ActivePlan | null | undefined>(undefined);
  const [custom, setCustom] = useState<Workout[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [calendar, setCalendar] = useState(false);
  const today = isoDate(new Date());

  useEffect(() => {
    let live = true;
    void getActivePlan().then((p) => live && setStored(p));
    void listCustomWorkouts().then((w) => live && setCustom(w));
    return () => {
      live = false;
    };
  }, []);

  const start = async (p: ActivePlan) => {
    setStored(p);
    setPicked(null);
    await saveActivePlan(p);
  };

  const end = async () => {
    if (!window.confirm('End this training plan? Your rides stay in History.')) return;
    setStored(null);
    setCalendar(false);
    await saveActivePlan(null);
  };

  const template = stored ? templateById(stored.templateId) : undefined;
  const resolve = (id: string) => resolveWorkout(id, ftp, custom);
  // the plan as it stands after today's rides: moved and lighter sessions (training/adapt.ts)
  const adapted = useMemo(
    () => (stored && template ? adapt(stored, template, rides, today, (id) => resolveWorkout(id, ftp, custom)) : null),
    [stored, template, rides, today, ftp, custom],
  );
  useEffect(() => {
    if (stored && adapted && !sameChanges(stored, adapted.active)) {
      setStored(adapted.active);
      void saveActivePlan(adapted.active);
    }
  }, [stored, adapted]);
  const active = adapted?.active ?? stored;
  const entries = useMemo(() => (active && template ? schedule(active, template) : []), [active, template]);
  const status = useMemo(() => completion(entries, rides, today), [entries, rides, today]);
  const entry = active && template ? entryFor(active, template, today) : null;
  const workout = entry && entry.day.workoutId !== 'free' ? resolve(entry.day.workoutId) : undefined;
  const todayStatus = status.get(today);
  // the route that lasts as long as today's session (or two, queued)
  const pick = useMemo(() => {
    if (!entry || todayStatus === 'done' || !routes.length) return null;
    return workout
      ? pickRoutes(routes, workout.duration, averagePower(workout, ftp), mass, entry.day.terrain)
      : pickRoutes(routes, 40 * 60, 0.75 * ftp, mass, 'climb');
  }, [entry, todayStatus, routes, workout, ftp, mass]);

  if (stored === undefined) return <section className="plan" aria-label="Training plan" />;

  if (!active || !template) {
    return (
      <section className="plan" aria-label="Training plan">
        <div className="section-head">
          <h2>Training plan</h2>
        </div>
        <ul className="plan-list">
          {PLAN_TEMPLATES.map((t) => {
            const open = picked === t.id;
            return (
              <li key={t.id} className={open ? 'on' : ''}>
                <button className="plan-row" aria-expanded={open} title={t.description} onClick={() => setPicked(open ? null : t.id)}>
                  <span className="w-name">{t.name}</span>
                  <span className="w-meta">
                    {t.repeat ? `${t.weeks.length} weeks, repeats` : `${t.weeks.length} weeks`}, {t.hoursPerWeek} per week
                  </span>
                </button>
                {open && <PlanStart template={t} today={today} onStart={(p) => void start(p)} />}
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  const notStarted = today < active.start;
  const stripMonday = mondayOf(notStarted ? active.start : today);
  const lastDate = entries.length ? entries[entries.length - 1].date : active.start;
  const finished = !template.repeat && today > lastDate && (!active.goal || today > active.goal.date);
  const weekNo = Math.max(0, weekIndex(active, stripMonday));
  const weekLabel = template.weeks[weekNo % template.weeks.length]?.label;
  const goal = active.goal;
  const form = adapted?.form;

  return (
    <section className="plan" aria-label="Training plan">
      <div className="section-head">
        <h2>Training plan</h2>
        <span className="muted plan-name">{template.name}</span>
      </div>
      {goal && (
        <p className="plan-goal">
          {goal.date > today ? `${goal.name} in ${days(today, goal.date)} days` : goal.date === today ? `${goal.name} today. Good luck.` : `${goal.name} was on ${shortDate(goal.date)}`}
        </p>
      )}
      {form && form.fitness >= 1 && (
        <p className="plan-form muted" title="From every ride's TSS: fitness over about six weeks, fatigue over the last week. Form is fitness minus fatigue.">
          Form <b className={form.form < TIRED ? 'tired' : form.form >= 0 ? 'fresh' : ''}>{Math.round(form.form)}</b>, fitness {Math.round(form.fitness)},
          fatigue {Math.round(form.fatigue)}
        </p>
      )}

      {finished ? (
        <p className="plan-today-line">Plan complete. Well done.</p>
      ) : notStarted ? (
        <p className="plan-today-line">Starts {shortDate(active.start)}.</p>
      ) : entry ? (
        <div className="plan-today">
          <div className="plan-today-head">
            <span className="muted">Today</span>
            <span className="w-name">{workout?.name ?? 'Free climb'}</span>
            <span className="w-meta">
              {workout ? `${Math.round(workout.duration / 60)} min, TSS ${Math.round(workout.tss)}` : '20 min or more'}
              {todayStatus === 'done' ? ', done' : ''}
            </span>
          </div>
          {entry.changed && <p className="plan-why">{entry.changed.why}</p>}
          {workout && <WorkoutChart workout={workout} height={44} compact />}
          {(entry.day.note || (entry.day.terrain && TERRAIN_HINT[entry.day.terrain])) && (
            <p className="muted plan-hint">{[entry.day.note, entry.day.terrain ? TERRAIN_HINT[entry.day.terrain] : ''].filter(Boolean).join(' ')}</p>
          )}
          {pick && (
            <p className="muted plan-hint">
              On {pick.names.join(', then ')}: about {minutes(pick.seconds)} at the session's power{pick.ids.length > 1 ? ', the second one queued' : ''}.
            </p>
          )}
          <button className={todayStatus === 'done' ? 'btn ghost' : 'btn'} onClick={() => onPickWorkout(entry.day.workoutId, todayStatus === 'done' ? undefined : pick?.ids)}>
            {todayStatus === 'done' ? 'Ride it again' : pick ? `Ride it on ${pick.names[0]}` : "Ride today's workout"}
          </button>
        </div>
      ) : (
        <p className="plan-today-line">
          <span className="muted">Today</span> Rest day
        </p>
      )}
      {adapted?.notes.map((n) => (
        <p key={n} className="plan-note">
          {n}
        </p>
      ))}

      <div className="plan-week-head muted">
        Week {weekNo + 1}
        {weekLabel ? `, ${weekLabel}` : ''}
      </div>
      <ol className="plan-strip">
        {DAY_NAMES.map((name, i) => {
          const date = addDays(stripMonday, i);
          const e = entryFor(active, template, date);
          const st = status.get(date);
          const wk = e && e.day.workoutId !== 'free' ? resolve(e.day.workoutId) : undefined;
          const what = wk ? `${wk.name}, ${Math.round(wk.duration / 60)} min` : e ? 'Free climb' : goal?.date === date ? goal.name : 'Rest';
          return (
            <li
              key={name}
              className={`${st ?? 'rest'} ${date === today ? 'is-today' : ''} ${e?.changed ? 'changed' : ''} ${goal?.date === date ? 'goal' : ''}`}
              title={e?.changed ? `${what}. ${e.changed.why}` : what}
            >
              <span className="ps-day">{name}</span>
              <span className="ps-mark">{st === 'done' ? '✓' : st === 'missed' ? 'Missed' : e ? `${wk ? Math.round(wk.duration / 60) : 20} min` : ''}</span>
              <span className="ps-name">{e ? (wk?.name ?? 'Free climb') : goal?.date === date ? goal.name : 'Rest'}</span>
            </li>
          );
        })}
      </ol>

      <div className="plan-actions">
        <button className="btn ghost small" onClick={() => setCalendar(true)}>
          Full plan
        </button>
        <button className="btn ghost small" onClick={() => void end()}>
          End plan
        </button>
      </div>

      {calendar && (
        <PlanCalendar
          active={active}
          template={template}
          ftp={ftp}
          rides={rides}
          custom={custom}
          today={today}
          onPickWorkout={(id) => onPickWorkout(id)}
          onClose={() => setCalendar(false)}
        />
      )}
    </section>
  );
}

/** Start a plan: next Monday, today, or so that it ends in an event's week. */
function PlanStart({ template: t, today, onStart }: { template: PlanTemplate; today: string; onStart: (p: ActivePlan) => void }) {
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const monday = nextMonday(today);
  const goal = date > today ? { name: name.trim() || 'Your event', date } : null;
  const preview = goal ? planForGoal(t, goal, today) : null;
  return (
    <div className="plan-more">
      <p className="muted">{t.description}</p>
      <div className="plan-start">
        <button className="btn" onClick={() => onStart({ templateId: t.id, start: monday })}>
          Start on Monday {shortDate(monday)}
        </button>
        <button className="btn ghost" onClick={() => onStart({ templateId: t.id, start: today })}>
          Start today
        </button>
      </div>
      {!t.repeat && (
        <div className="plan-goal-form">
          <span className="muted small">Or towards an event: the plan ends in its week.</span>
          <div className="row">
            <input type="text" placeholder="Event, e.g. a hill climb" value={name} onChange={(e) => setName(e.target.value)} aria-label="Event name" />
            <input type="date" min={addDays(today, 1)} value={date} onChange={(e) => setDate(e.target.value)} aria-label="Event date" />
            <button className="btn ghost" disabled={!preview} onClick={() => preview && onStart(preview)}>
              Plan towards it
            </button>
          </div>
          {preview && (
            <span className="muted small">
              {preview.weekZero
                ? `Joins today in week ${Math.floor(days(preview.weekZero, today) / 7) + 1} of ${t.weeks.length}: the event is closer than the plan is long.`
                : `Starts Monday ${shortDate(preview.start)}, ${t.weeks.length} weeks before.`}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
