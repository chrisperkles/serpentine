export type PlanTerrain = 'climb' | 'flat' | 'any';

export interface PlanDay {
  day: 0 | 1 | 2 | 3 | 4 | 5 | 6; // Monday = 0
  /** A workout id, or 'free' for an unstructured climb. */
  workoutId: string;
  terrain?: PlanTerrain;
  note?: string;
}

export interface PlanWeek {
  label: string;
  days: PlanDay[];
}

export interface PlanTemplate {
  id: string;
  name: string;
  description: string;
  hoursPerWeek: string;
  /** Weeks cycle forever; the calendar shows `cycles` repeats. */
  repeat?: boolean;
  weeks: PlanWeek[];
}

/** A session the plan moved or swapped (training/adapt.ts). */
export interface PlanChange {
  /** What to ride that day instead; null takes the session out. */
  workoutId: string | null;
  terrain?: PlanTerrain;
  /** Why, in a sentence the rider sees. */
  why: string;
}

export interface Goal {
  name: string;
  /** ISO date of the event. */
  date: string;
}

export interface ActivePlan {
  templateId: string;
  /** ISO date (YYYY-MM-DD). A Monday for "start on Monday"; any day for "start today". */
  start: string;
  /** Monday of the plan's first week, when the plan was joined mid-way to end in an event's week. */
  weekZero?: string;
  /** The event the plan builds to: the plan ends in its week, easy the day before, nothing from the day on. */
  goal?: Goal;
  /** Moved and swapped sessions by date. Past ones stay as they were, so History keeps what was planned. */
  changes?: Record<string, PlanChange>;
}

export interface PlanEntry {
  date: string;
  week: number;
  day: PlanDay;
  /** The plan changed this day: what it said before (null: a rest day) and why. */
  changed?: { from: string | null; why: string };
}

export type DayStatus = 'done' | 'missed' | 'planned' | 'today';

const CYCLES = 3;
const FREE = 'free';

type D = PlanDay['day'];
const d = (day: D, workoutId: string, terrain?: PlanTerrain, note?: string): PlanDay => {
  const x: PlanDay = { day, workoutId };
  if (terrain) x.terrain = terrain;
  if (note) x.note = note;
  return x;
};

export const PLAN_TEMPLATES: PlanTemplate[] = [
  {
    id: 'base-builder',
    name: 'Base builder',
    description: 'Four weeks of aerobic base. Mostly Zone 2 with a little tempo, and an easy final week to absorb it.',
    hoursPerWeek: '3 to 4 h',
    weeks: [
      { label: 'Settle in', days: [d(1, 'easy-spin'), d(3, 'endurance-60'), d(5, 'endurance-base')] },
      { label: 'Build', days: [d(1, 'endurance-60'), d(3, 'tempo-trio'), d(5, 'endurance-base', 'any', 'Fuel early and often.'), d(6, 'recovery-30')] },
      { label: 'Extend', days: [d(1, 'tempo-trio'), d(3, 'endurance-60'), d(5, 'endurance-2h', 'any', 'Fuel early and often.')] },
      { label: 'Recovery week', days: [d(1, 'easy-spin'), d(3, 'endurance-60'), d(5, 'endurance-base')] },
    ],
  },
  {
    id: 'climbing-build',
    name: 'Climbing build',
    description: 'Six weeks for long mountain climbs: seated tempo, low-cadence strength, then Alpine Repeats and Summit Push on climbing routes.',
    hoursPerWeek: '4 to 6 h',
    weeks: [
      { label: 'Foundations', days: [d(1, 'sweet-spot-3x12'), d(3, 'climbing-tempo', 'climb'), d(5, 'endurance-2h'), d(6, 'recovery-30')] },
      { label: 'Strength', days: [d(1, 'alpine-repeats', 'climb'), d(2, 'recovery-30'), d(3, 'endurance-60'), d(5, 'endurance-2h'), d(6, 'tempo-trio')] },
      { label: 'Sustained climbing', days: [d(1, 'sweet-spot-2x20'), d(2, 'easy-spin'), d(3, 'alpine-repeats', 'climb'), d(5, 'summit-push', 'climb'), d(6, 'endurance-60')] },
      { label: 'Recovery week', days: [d(1, 'easy-spin'), d(3, 'climbing-tempo', 'climb'), d(5, 'endurance-base')] },
      { label: 'Peak', days: [d(1, 'threshold-4x8'), d(2, 'recovery-30'), d(3, 'alpine-repeats', 'climb'), d(5, 'summit-push', 'climb'), d(6, 'endurance-60')] },
      { label: 'Taper', days: [d(1, 'tempo-trio'), d(3, 'alpine-repeats', 'climb'), d(5, 'easy-spin'), d(6, FREE, 'climb', 'Ride a favourite climb at your own pace.')] },
    ],
  },
  {
    id: 'ftp-builder',
    name: 'FTP builder',
    description: 'Six weeks from sweet spot to threshold to VO2. A ramp test opens and closes the plan so you can see the gain.',
    hoursPerWeek: '3 to 5 h',
    weeks: [
      { label: 'Baseline', days: [d(0, 'ramp-test', 'any', 'Fresh legs. Ride until you cannot hold the target.'), d(2, 'endurance-60'), d(3, 'sweet-spot-3x12'), d(5, 'endurance-base'), d(6, 'recovery-30')] },
      { label: 'Sweet spot', days: [d(1, 'sweet-spot-2x20'), d(3, 'endurance-60'), d(5, 'sweet-spot-ladder'), d(6, 'easy-spin')] },
      { label: 'Sweet spot to threshold', days: [d(1, 'sweet-spot-2x20'), d(2, 'recovery-30'), d(3, 'threshold-4x8'), d(5, 'endurance-2h')] },
      { label: 'Recovery week', days: [d(1, 'easy-spin'), d(3, 'sweet-spot-3x12'), d(5, 'endurance-base')] },
      { label: 'Threshold and VO2', days: [d(1, 'threshold-2x20'), d(3, 'vo2-5x4'), d(5, 'over-unders'), d(6, 'endurance-60')] },
      { label: 'Retest', days: [d(1, 'vo2-30-30'), d(3, 'endurance-60'), d(5, 'recovery-30'), d(6, 'ramp-test', 'any', 'Compare with week 1.')] },
    ],
  },
  {
    id: 'keep-fit',
    name: 'Keep fit',
    description: 'Three easy-going sessions a week that hold your fitness. Four weeks that repeat for as long as you like.',
    hoursPerWeek: '2 to 3 h',
    repeat: true,
    weeks: [
      { label: 'Steady', days: [d(1, 'endurance-60'), d(3, 'sweet-spot-3x12'), d(5, 'easy-spin')] },
      { label: 'Tempo', days: [d(1, 'tempo-trio'), d(3, 'endurance-60'), d(6, 'easy-spin')] },
      { label: 'Sweet spot', days: [d(1, 'sweet-spot-ladder'), d(3, 'endurance-60'), d(5, 'easy-spin')] },
      { label: 'Recovery week', days: [d(1, 'easy-spin'), d(3, 'endurance-60'), d(5, 'recovery-30')] },
    ],
  },
];

export function templateById(id: string): PlanTemplate | undefined {
  return PLAN_TEMPLATES.find((t) => t.id === id);
}

// Dates are plain YYYY-MM-DD strings in local time; arithmetic goes through UTC so DST never shifts a day.
const utc = (iso: string) => {
  const [y, m, dd] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, dd);
};

export function isoDate(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

export function addDays(iso: string, n: number): string {
  return new Date(utc(iso) + n * 86400000).toISOString().slice(0, 10);
}

/** Monday = 0 … Sunday = 6. */
export function weekday(iso: string): number {
  return (new Date(utc(iso)).getUTCDay() + 6) % 7;
}

export function mondayOf(iso: string): string {
  return addDays(iso, -weekday(iso));
}

/** The first Monday strictly after `date` (today on a Monday gives next week's). */
export function nextMonday(date: Date | string = new Date()): string {
  const iso = typeof date === 'string' ? date : isoDate(date);
  return addDays(iso, 7 - weekday(iso));
}

/** Monday of the plan's first week. */
export function firstMonday(active: ActivePlan): string {
  return active.weekZero ?? mondayOf(active.start);
}

/** The event's rules on the template's session for a date: nothing from the event day on, easy the day before. */
function withGoal(active: ActivePlan, e: PlanEntry | null): PlanEntry | null {
  const g = active.goal;
  if (!e || !g) return e;
  if (e.date >= g.date) return null;
  if (e.date === addDays(g.date, -1)) return { ...e, day: { day: e.day.day, workoutId: 'easy-spin', note: `Easy legs before ${g.name}.` } };
  return e;
}

/** A stored change on top of the template's session (or rest day) for a date. */
function withChange(active: ActivePlan, date: string, e: PlanEntry | null): PlanEntry | null {
  const c = active.changes?.[date];
  if (!c) return e;
  if (c.workoutId === null) return null;
  const day: PlanDay = { day: weekday(date) as D, workoutId: c.workoutId };
  const terrain = c.terrain ?? e?.day.terrain;
  if (terrain) day.terrain = terrain;
  return { date, week: e?.week ?? weekIndex(active, date), day, changed: { from: e?.day.workoutId ?? null, why: c.why } };
}

/** The template's sessions only (and the event's rules), without moved or swapped ones: what adapt() starts from. */
export function templateSchedule(active: ActivePlan, template: PlanTemplate): PlanEntry[] {
  const monday = firstMonday(active);
  const total = template.repeat ? template.weeks.length * CYCLES : template.weeks.length;
  const out: PlanEntry[] = [];
  for (let w = 0; w < total; w++) {
    const week = template.weeks[w % template.weeks.length];
    for (const day of [...week.days].sort((a, b) => a.day - b.day)) {
      const date = addDays(monday, w * 7 + day.day);
      const e = date >= active.start ? withGoal(active, { date, week: w, day }) : null;
      if (e) out.push(e);
    }
  }
  return out;
}

/** All planned sessions in date order, changes included. Repeating plans are expanded for a few cycles. */
export function schedule(active: ActivePlan, template: PlanTemplate): PlanEntry[] {
  const base = templateSchedule(active, template);
  if (!active.changes) return base;
  const byDate = new Map(base.map((e) => [e.date, e]));
  for (const date of Object.keys(active.changes)) {
    const e = withChange(active, date, byDate.get(date) ?? null);
    if (e) byDate.set(date, e);
    else byDate.delete(date);
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** The session planned for a date (changes included), or null on a rest day or outside the plan. */
export function entryFor(active: ActivePlan, template: PlanTemplate, date: string): PlanEntry | null {
  const monday = firstMonday(active);
  const offset = Math.round((utc(date) - utc(monday)) / 86400000);
  let e: PlanEntry | null = null;
  if (offset >= 0 && date >= active.start) {
    const w = Math.floor(offset / 7);
    if (template.repeat || w < template.weeks.length) {
      const day = template.weeks[w % template.weeks.length].days.find((x) => x.day === offset % 7);
      if (day) e = withGoal(active, { date, week: w, day });
    }
  }
  return withChange(active, date, e);
}

/** Week index (0-based) a date falls in, or -1 before the start. */
export function weekIndex(active: ActivePlan, date: string): number {
  const offset = Math.round((utc(date) - utc(firstMonday(active))) / 86400000);
  return offset < 0 ? -1 : Math.floor(offset / 7);
}

/**
 * A plan that ends in the event's week: its first Monday is as many weeks before as the plan is long. When that
 * Monday has passed, the plan starts today, part way in.
 */
export function planForGoal(template: PlanTemplate, goal: Goal, today: string): ActivePlan {
  const weekZero = addDays(mondayOf(goal.date), -7 * (template.weeks.length - 1));
  return weekZero >= today ? { templateId: template.id, start: weekZero, goal } : { templateId: template.id, start: today, weekZero, goal };
}

export interface PlanRide {
  start: number;
  workoutId?: string;
  /** Seconds; rides without a duration count towards free-climb days. */
  duration?: number;
  /** Training stress, for fitness and fatigue (training/adapt.ts). */
  tss?: number;
}

export function completion(entries: PlanEntry[], rides: PlanRide[], today: Date | string = new Date()): Map<string, DayStatus> {
  const todayIso = typeof today === 'string' ? today : isoDate(today);
  const byDay = new Map<string, PlanRide[]>();
  for (const r of rides) {
    const k = isoDate(new Date(r.start));
    const list = byDay.get(k);
    if (list) list.push(r);
    else byDay.set(k, [r]);
  }
  const out = new Map<string, DayStatus>();
  for (const e of entries) {
    const day = byDay.get(e.date) ?? [];
    const done =
      e.day.workoutId === FREE
        ? day.some((r) => (r.duration ?? Infinity) >= 20 * 60)
        : day.some((r) => r.workoutId === e.day.workoutId);
    out.set(e.date, done ? 'done' : e.date < todayIso ? 'missed' : e.date === todayIso ? 'today' : 'planned');
  }
  return out;
}
