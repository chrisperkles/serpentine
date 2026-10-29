// A plan that follows what was actually ridden, the way Zwift's Coach does it (DC Rainmaker's review, 2026-10-29):
// people wrote the workouts, and what changes is which session lands on which day. Rules, not a model, so every
// change can say why:
// - a hard session missed in the last three days moves to a free day later this week, unless that puts two hard
//   days back to back; then it is left out
// - after a hard ride the plan didn't ask for, the next hard session in the two days after becomes an easy one
// - with form below TIRED the next hard session in the coming two days becomes recovery
// Fitness (CTL, 42 days), fatigue (ATL, 7 days) and form (fitness minus fatigue) come from every ride's TSS.
// Only today and later are recomputed; changes on past days stay as they were, so History shows what was planned.

import type { Workout } from '../workouts/types.ts';
import { RAMP_TEST_ID } from './rampTest.ts';
import {
  addDays, completion, isoDate, mondayOf, schedule, weekday,
  type ActivePlan, type PlanChange, type PlanRide, type PlanTemplate,
} from './plans.ts';

export interface Form {
  /** CTL: TSS a day over the last ~6 weeks. */
  fitness: number;
  /** ATL: TSS a day over the last week. */
  fatigue: number;
  /** Fitness minus fatigue: below zero you are carrying fatigue, below TIRED it is time to back off. */
  form: number;
}

const CTL_DAYS = 42;
const ATL_DAYS = 7;
export const TIRED = -25;
/** A ride this hard, when the plan didn't ask for it, counts as a hard day. */
export const HARD_RIDE_TSS = 80;
/** Workouts at least this intense (IF) are hard sessions; the ramp test too. */
const HARD_IF = 0.78;
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export const dayName = (iso: string) => DAY_NAMES[weekday(iso)];

export function isHard(w: Workout | undefined): boolean {
  return !!w && (w.id === RAMP_TEST_ID || w.intensityFactor >= HARD_IF);
}

/** Fitness, fatigue and form at the end of `today`, from up to half a year of rides. */
export function trainingLoad(rides: PlanRide[], today: string): Form {
  const daily = new Map<string, number>();
  for (const r of rides) {
    const d = isoDate(new Date(r.start));
    if (d <= today) daily.set(d, (daily.get(d) ?? 0) + (r.tss ?? 0));
  }
  if (!daily.size) return { fitness: 0, fatigue: 0, form: 0 };
  const first = [...daily.keys()].sort()[0];
  let ctl = 0;
  let atl = 0;
  for (let d = first < addDays(today, -180) ? addDays(today, -180) : first; d <= today; d = addDays(d, 1)) {
    const t = daily.get(d) ?? 0;
    ctl += (t - ctl) / CTL_DAYS;
    atl += (t - atl) / ATL_DAYS;
  }
  return { fitness: ctl, fatigue: atl, form: ctl - atl };
}

export interface Adapted {
  /** The plan with today's and later changes worked out again. */
  active: ActivePlan;
  form: Form;
  /** Sessions the rules had to leave out, for the rider to read. */
  notes: string[];
}

export function adapt(
  active: ActivePlan,
  template: PlanTemplate,
  rides: PlanRide[],
  today: string,
  resolve: (id: string) => Workout | undefined,
): Adapted {
  const kept: Record<string, PlanChange> = {};
  for (const [d, c] of Object.entries(active.changes ?? {})) if (d < today) kept[d] = c;
  const base: ActivePlan = { ...active, changes: kept };
  const entries = schedule(base, template);
  const status = completion(entries, rides, today);
  const form = trainingLoad(rides, today);
  const future: Record<string, PlanChange> = {};
  const notes: string[] = [];

  const planned = new Map(entries.map((e) => [e.date, e]));
  const idAt = (d: string): string | null => (d in future ? future[d].workoutId : (planned.get(d)?.day.workoutId ?? null));
  const hardId = (id: string | null) => !!id && id !== 'free' && isHard(resolve(id));
  const ridesOn = (d: string) => rides.filter((r) => isoDate(new Date(r.start)) === d);
  const rodeHard = (d: string) => ridesOn(d).some((r) => (r.tss ?? 0) >= HARD_RIDE_TSS);
  const hardDay = (d: string) => (d < today ? rodeHard(d) : hardId(idAt(d)) || rodeHard(d));
  const tired = form.form < TIRED;
  const sunday = addDays(mondayOf(today), 6);
  const end = active.goal ? (addDays(active.goal.date, -2) < sunday ? addDays(active.goal.date, -2) : sunday) : sunday;
  const lastPlanned = entries.length ? entries[entries.length - 1].date : today;

  // 1. hard sessions missed this week move to a free day, never next to another hard day
  const handled = new Set<string>();
  const missed = entries.filter(
    (e) => status.get(e.date) === 'missed' && e.date >= mondayOf(today) && e.date >= addDays(today, -3) && hardId(e.day.workoutId),
  );
  for (const e of missed.reverse()) {
    const id = e.day.workoutId;
    if (handled.has(id)) continue;
    handled.add(id);
    const name = resolve(id)?.name ?? id;
    const why = `Moved from ${dayName(e.date)}, when it was missed.`;
    // made up already, on a later day: that day shows it as the moved session
    const madeUp = rides.find((r) => r.workoutId === id && isoDate(new Date(r.start)) > e.date);
    if (madeUp) {
      const m = isoDate(new Date(madeUp.start));
      if (m >= today && idAt(m) === null) future[m] = { workoutId: id, terrain: e.day.terrain, why };
      continue;
    }
    if (tired) {
      notes.push(`${dayName(e.date)}'s ${name} is left out: you are carrying a lot of fatigue.`);
      continue;
    }
    let slot: string | null = null;
    for (let d = today; d <= end && d <= lastPlanned && !slot; d = addDays(d, 1)) {
      if (idAt(d) !== null || ridesOn(d).length) continue;
      if (hardDay(addDays(d, -1)) || hardDay(addDays(d, 1))) continue;
      slot = d;
    }
    if (slot) future[slot] = { workoutId: id, terrain: e.day.terrain, why };
    else notes.push(`${dayName(e.date)}'s ${name} is left out: no free day this week without two hard days in a row.`);
  }

  /** The next hard session from `from` to `to` that isn't ridden yet. */
  const nextHard = (from: string, to: string): string | null => {
    for (let d = from; d <= to; d = addDays(d, 1)) {
      if (d < today || status.get(d) === 'done') continue;
      if (hardId(idAt(d))) return d;
    }
    return null;
  };

  // 2. a hard ride the plan didn't ask for: the next hard session in the two days after it goes easy
  for (const d of [addDays(today, -1), today]) {
    // planned: that day's session, a free climb ridden as one, or a missed session made up
    const week = new Set(entries.filter((e) => e.date > addDays(d, -7) && e.date < d).map((e) => e.day.workoutId));
    const id = idAt(d);
    const isPlanned = (r: PlanRide) => (r.workoutId ? r.workoutId === id || week.has(r.workoutId) : id === 'free');
    const extra = ridesOn(d).filter((r) => (r.tss ?? 0) >= HARD_RIDE_TSS && !isPlanned(r));
    if (!extra.length) continue;
    const x = nextHard(addDays(d, 1), addDays(d, 2));
    if (!x) continue;
    const tss = Math.round(Math.max(...extra.map((r) => r.tss ?? 0)));
    future[x] = {
      workoutId: tired ? 'recovery-30' : 'endurance-60',
      why: `Easier after ${d === today ? "today's" : `${dayName(d)}'s`} hard ride (TSS ${tss}), which the plan didn't ask for.`,
    };
  }

  // 3. carrying too much fatigue: recovery before the next hard session
  if (tired) {
    const x = nextHard(today, addDays(today, 2));
    if (x && !(x in future)) {
      future[x] = { workoutId: 'recovery-30', why: `Recovery first: your form is ${Math.round(form.form)}, a lot of fatigue for now.` };
    }
  }

  // a change back to what the template says is no change
  for (const [d, c] of Object.entries(future)) if (c.workoutId === (planned.get(d)?.day.workoutId ?? null)) delete future[d];
  const changes = { ...kept, ...future };
  return { active: { ...active, changes: Object.keys(changes).length ? changes : undefined }, form, notes };
}

/** True when two plans store the same changes (so a re-render doesn't save the plan again). */
export function sameChanges(a: ActivePlan, b: ActivePlan): boolean {
  return JSON.stringify(a.changes ?? {}) === JSON.stringify(b.changes ?? {});
}
