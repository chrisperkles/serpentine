import { useEffect, useMemo } from 'react';
import { addDays, completion, firstMonday, schedule, weekIndex, type ActivePlan, type DayStatus, type PlanRide, type PlanTemplate } from '../training/plans.ts';
import { resolveWorkout } from '../training/resolve.ts';
import type { Workout } from '../workouts/types.ts';

export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export const STATUS_LABEL: Record<DayStatus, string> = { done: '✓', missed: 'Missed', planned: '', today: 'Today' };

interface Props {
  active: ActivePlan;
  template: PlanTemplate;
  ftp: number;
  rides: PlanRide[];
  custom?: Workout[];
  today: string;
  onPickWorkout: (workoutId: string) => void;
  onClose: () => void;
}

/** Every week of the plan as a row of seven days. Clicking a planned day picks its workout. */
export function PlanCalendar({ active, template, ftp, rides, custom = [], today, onPickWorkout, onClose }: Props) {
  const entries = useMemo(() => schedule(active, template), [active, template]);
  const status = useMemo(() => completion(entries, rides, today), [entries, rides, today]);
  const byDate = useMemo(() => new Map(entries.map((e) => [e.date, e])), [entries]);
  const weeks = entries.length ? entries[entries.length - 1].week + 1 : 0;
  const monday = firstMonday(active);
  const current = weekIndex(active, today);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="plan-cal" role="dialog" aria-label={`${template.name} plan`}>
        <header>
          <div>
            <h2>{template.name}</h2>
            <p className="muted">
              Starts {shortDate(active.start)}, {template.hoursPerWeek} per week
              {active.goal ? `, towards ${active.goal.name} on ${shortDate(active.goal.date)}` : ''}
            </p>
          </div>
          <button className="btn ghost small" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="plan-cal-body">
          <div className="plan-cal-grid head">
            <span />
            {DAY_NAMES.map((n) => (
              <span key={n}>{n}</span>
            ))}
          </div>
          {Array.from({ length: weeks }, (_, w) => {
            const label = template.weeks[w % template.weeks.length].label;
            return (
              <div key={w} className={`plan-cal-grid ${w === current ? 'now' : ''}`}>
                <div className="plan-cal-week">
                  <b>Week {w + 1}</b>
                  <span className="muted">{label}</span>
                </div>
                {DAY_NAMES.map((_, di) => {
                  const date = addDays(monday, w * 7 + di);
                  const e = byDate.get(date);
                  if (!e) return <div key={di} className="plan-cal-day rest" />;
                  const wk = e.day.workoutId === 'free' ? undefined : resolveWorkout(e.day.workoutId, ftp, custom);
                  const st = status.get(date) ?? 'planned';
                  return (
                    <button
                      key={di}
                      className={`plan-cal-day ${st}${e.changed ? ' changed' : ''}`}
                      title={[e.changed?.why, e.day.note].filter(Boolean).join(' ') || undefined}
                      onClick={() => {
                        onPickWorkout(e.day.workoutId);
                        onClose();
                      }}
                    >
                      <span className="pc-name">{wk?.name ?? 'Free climb'}</span>
                      <span className="pc-meta">
                        {wk ? `${Math.round(wk.duration / 60)} min` : 'Free'}
                        {e.day.terrain === 'climb' ? ', climb' : ''}
                      </span>
                      <span className="pc-state">{STATUS_LABEL[st] || shortDate(date)}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
