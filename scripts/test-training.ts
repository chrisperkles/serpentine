import assert from 'node:assert/strict';
import { LIBRARY } from '../src/workouts/index.ts';
import { RAMP_TEST_ID, buildRampTest, ftpFromRamp, rampFailure } from '../src/training/rampTest.ts';
import { PLAN_TEMPLATES, completion, entryFor, nextMonday, planForGoal, schedule, weekday, type ActivePlan } from '../src/training/plans.ts';
import { adapt, trainingLoad } from '../src/training/adapt.ts';
import { intervalFeedback } from '../src/training/feedback.ts';
import { pickRoutes, rideTime } from '../src/training/routeFit.ts';
import type { RideRecord } from '../src/sim/types.ts';
import type { Workout } from '../src/workouts/types.ts';
import { resolveWorkout } from '../src/training/resolve.ts';

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`);

// 1. ramp test structure
{
  const w = buildRampTest(250);
  assert.equal(w.id, RAMP_TEST_ID);
  assert.equal(w.name, 'FTP ramp test');
  assert.equal(w.steps.length, 2 + 40);
  assert.equal(w.steps[0].kind, 'warmup');
  assert.equal(w.steps[0].duration, 300);
  near(w.steps[0].start, 0.4);
  near(w.steps[0].end, 0.55);
  assert.equal(w.steps[1].duration, 120);
  near(w.steps[1].start, 0.5);
  const ramp = w.steps.slice(2);
  assert.ok(ramp.every((s) => s.duration === 60));
  assert.equal(Math.round(ramp[0].start * 250), 125); // round5(0.5 * 250)
  assert.equal(Math.round(ramp[1].start * 250), 140); // + round5(15)
  assert.equal(Math.round(ramp[39].start * 250), 125 + 39 * 15);
  assert.equal(w.duration, 300 + 120 + 40 * 60);
  assert.ok(w.messages.some((m) => /cadence above 80/i.test(m.text)));
  assert.ok(w.messages.every((m) => m.at >= 0 && m.at < w.duration));
  // other FTP: 237 -> start round5(118.5)=120, inc round5(14.22)=15
  const w2 = buildRampTest(237);
  assert.equal(Math.round(w2.steps[2].start * 237), 120);
  assert.equal(Math.round(w2.steps[3].start * 237) - 120, 15);
}

// 2. ftpFromRamp
{
  assert.equal(ftpFromRamp([]), 0);
  const p = [...Array(300).fill(150), ...Array(60).fill(320), ...Array(10).fill(50)];
  assert.equal(ftpFromRamp(p), 240); // 0.75 * 320
  // best window straddles a step: 30 s @ 300 + 30 s @ 340 -> 320
  const q = [...Array(120).fill(200), ...Array(30).fill(300), ...Array(30).fill(340), ...Array(5).fill(0)];
  assert.equal(ftpFromRamp(q), 240);
  assert.equal(ftpFromRamp(Array(20).fill(200)), 150); // shorter than 60 s
  assert.equal(ftpFromRamp(Array(100).fill(251)), Math.round(0.75 * 251));
}

// 3. rampFailure
{
  const ok = (n: number) => Array.from({ length: n }, () => ({ power: 300, cadence: 90, target: 300 }));
  assert.equal(rampFailure(ok(15)), false);
  assert.equal(rampFailure([]), false);
  const cadLow = (n: number) => Array.from({ length: n }, () => ({ power: 300, cadence: 45, target: 300 }));
  assert.equal(rampFailure([...ok(10), ...cadLow(5)]), true);
  assert.equal(rampFailure([...ok(10), ...cadLow(4)]), false);
  assert.equal(rampFailure([...cadLow(3), ...ok(1), ...cadLow(3), ...ok(8)]), false); // not consecutive
  const powLow = (n: number) => Array.from({ length: n }, () => ({ power: 200, cadence: 85, target: 300 }));
  assert.equal(rampFailure([...ok(5), ...powLow(10)]), true);
  assert.equal(rampFailure([...ok(6), ...powLow(9)]), false);
  assert.equal(rampFailure(Array.from({ length: 15 }, () => ({ power: 0, cadence: 90, target: null }))), false);
  assert.equal(rampFailure(Array.from({ length: 12 }, () => ({ power: 209, cadence: 90, target: 300 }))), true); // < 0.7
  assert.equal(rampFailure(Array.from({ length: 12 }, () => ({ power: 210, cadence: 90, target: 300 }))), false); // = 0.7
}

// 4. templates reference real workouts and look sensible
{
  const ids = new Set([...LIBRARY.map((w) => w.id), RAMP_TEST_ID, 'free']);
  assert.equal(PLAN_TEMPLATES.length, 4);
  const expected: Record<string, number> = { 'base-builder': 4, 'climbing-build': 6, 'ftp-builder': 6, 'keep-fit': 4 };
  for (const t of PLAN_TEMPLATES) {
    assert.equal(t.weeks.length, expected[t.id], t.id);
    const hours: number[] = [];
    t.weeks.forEach((wk, i) => {
      assert.ok(wk.days.length >= 3 && wk.days.length <= 5, `${t.id} week ${i + 1} sessions`);
      const seen = new Set<number>();
      for (const d of wk.days) {
        assert.ok(ids.has(d.workoutId), `${t.id}: unknown workout ${d.workoutId}`);
        assert.ok(d.day >= 0 && d.day <= 6);
        assert.ok(!seen.has(d.day), `${t.id} week ${i + 1}: duplicate day`);
        seen.add(d.day);
      }
      hours.push(wk.days.reduce((a, d) => a + (resolveWorkout(d.workoutId, 250)?.duration ?? 3600), 0) / 3600);
    });
    console.log(`  ${t.id}: hours/week ${hours.map((h) => h.toFixed(1)).join(' ')} (${t.hoursPerWeek})`);
  }
  const ftp = PLAN_TEMPLATES.find((t) => t.id === 'ftp-builder')!;
  assert.equal(ftp.weeks[0].days.find((d) => d.day === 0)?.workoutId, RAMP_TEST_ID);
  assert.ok(ftp.weeks[ftp.weeks.length - 1].days.some((d) => d.workoutId === RAMP_TEST_ID));
  const climb = PLAN_TEMPLATES.find((t) => t.id === 'climbing-build')!;
  const climbIds = climb.weeks.flatMap((w) => w.days.map((d) => d.workoutId));
  assert.ok(climbIds.includes('alpine-repeats') && climbIds.includes('summit-push'));
  for (const t of PLAN_TEMPLATES.filter((x) => x.id !== 'keep-fit')) {
    const hrs = t.weeks.map((wk) => wk.days.reduce((a, d) => a + (resolveWorkout(d.workoutId, 250)?.duration ?? 3600), 0));
    assert.ok(hrs.some((h, i) => i > 0 && h < Math.max(...hrs.slice(0, i)) * 0.85), `${t.id} has a lighter week`);
  }
}

// 5. dates
{
  assert.equal(nextMonday('2026-10-10'), '2026-10-12'); // Saturday
  assert.equal(nextMonday('2026-10-12'), '2026-10-19'); // Monday -> following Monday
  assert.equal(nextMonday('2026-10-11'), '2026-10-12'); // Sunday
  assert.equal(nextMonday(new Date(2026, 9, 14)), '2026-10-19');
  assert.equal(weekday('2026-10-12'), 0);
  assert.equal(weekday('2026-10-18'), 6);
  const active: ActivePlan = { templateId: 'ftp-builder', start: '2026-10-12' };
  const t = PLAN_TEMPLATES.find((x) => x.id === 'ftp-builder')!;
  const s = schedule(active, t);
  assert.equal(s[0].date, '2026-10-12');
  assert.equal(s[0].day.workoutId, RAMP_TEST_ID);
  assert.equal(s[0].week, 0);
  assert.equal(s[1].date, '2026-10-14'); // Wednesday
  const last = s[s.length - 1];
  assert.equal(last.week, 5);
  assert.equal(last.date, '2026-11-22'); // week 6 Sunday: 12 Oct + 35 + 6 days
  assert.equal(weekday(last.date), 6);
  assert.equal(s.length, t.weeks.reduce((a, w) => a + w.days.length, 0));
  assert.ok(s.every((e, i) => i === 0 || e.date > s[i - 1].date));
  // dates cross DST end (25 Oct 2026) correctly
  assert.equal(entryFor(active, t, '2026-10-27')?.day.workoutId, 'sweet-spot-2x20'); // Tue of week 2
  assert.equal(entryFor(active, t, '2026-10-13'), null); // rest day
  assert.equal(entryFor(active, t, '2026-10-11'), null); // before start
  assert.equal(entryFor(active, t, '2026-11-30'), null); // after the plan
  // start today (mid-week) drops earlier days
  const mid: ActivePlan = { templateId: 'ftp-builder', start: '2026-10-14' };
  assert.equal(schedule(mid, t)[0].date, '2026-10-14');
  assert.equal(entryFor(mid, t, '2026-10-12'), null);
  // repeating plan
  const kf = PLAN_TEMPLATES.find((x) => x.id === 'keep-fit')!;
  const ks = schedule({ templateId: 'keep-fit', start: '2026-10-12' }, kf);
  assert.equal(ks.length, kf.weeks.reduce((a, w) => a + w.days.length, 0) * 3);
  assert.equal(entryFor({ templateId: 'keep-fit', start: '2026-10-12' }, kf, '2026-12-08')?.day.workoutId, 'endurance-60'); // week 9 Tue = week 1 again
}

// 6. completion
{
  const active: ActivePlan = { templateId: 'climbing-build', start: '2026-10-12' };
  const t = PLAN_TEMPLATES.find((x) => x.id === 'climbing-build')!;
  const entries = schedule(active, t);
  const at = (iso: string, h = 18) => new Date(`${iso}T${String(h).padStart(2, '0')}:00:00`).getTime();
  const rides = [
    { start: at('2026-10-13'), workoutId: 'sweet-spot-3x12' }, // Tue: done
    { start: at('2026-10-15'), workoutId: 'tempo-trio' }, // Thu: wrong workout -> missed
    { start: at('2026-10-17', 9), workoutId: 'endurance-2h' }, // Sat done
  ];
  const c = completion(entries, rides, '2026-10-18'); // Sunday
  assert.equal(c.get('2026-10-13'), 'done');
  assert.equal(c.get('2026-10-15'), 'missed');
  assert.equal(c.get('2026-10-17'), 'done');
  assert.equal(c.get('2026-10-18'), 'today');
  assert.equal(c.get('2026-10-20'), 'planned');
  assert.equal(c.get('2026-10-14'), undefined); // rest day not an entry
  assert.equal(completion(entries, [...rides, { start: at('2026-10-18'), workoutId: 'recovery-30' }], '2026-10-18').get('2026-10-18'), 'done');
  // free-climb day needs a ride of 20+ minutes
  const last = entries.find((e) => e.day.workoutId === 'free')!;
  const short = completion(entries, [{ start: at(last.date), duration: 600 }], '2026-12-31');
  assert.equal(short.get(last.date), 'missed');
  const long = completion(entries, [{ start: at(last.date), duration: 25 * 60, workoutId: 'free' }], '2026-12-31');
  assert.equal(long.get(last.date), 'done');
  assert.equal(completion(entries, [], '2026-10-01').get('2026-10-13'), 'planned');
}

// 7. adaptive plan (training/adapt.ts): FTP builder from Mon 12 Oct; week 2 = Tue sweet-spot-2x20, Thu endurance-60,
// Sat sweet-spot-ladder, Sun easy-spin
{
  const t = PLAN_TEMPLATES.find((x) => x.id === 'ftp-builder')!;
  const plan: ActivePlan = { templateId: 'ftp-builder', start: '2026-10-12' };
  const at = (d: string, h = 18) => new Date(`${d}T${String(h).padStart(2, '0')}:00:00`).getTime();
  const res = (id: string) => resolveWorkout(id, 250);
  // week 1 ridden as planned, moderate load
  const week1 = [
    { start: at('2026-10-12'), workoutId: 'ramp-test', tss: 30 },
    { start: at('2026-10-14'), workoutId: 'endurance-60', tss: 40 },
    { start: at('2026-10-15'), workoutId: 'sweet-spot-3x12', tss: 69 },
    { start: at('2026-10-17'), workoutId: 'endurance-base', tss: 60 },
    { start: at('2026-10-18'), workoutId: 'recovery-30', tss: 11 },
  ];

  // a missed hard session moves to the next free day that isn't next to a hard one
  const wed = adapt(plan, t, week1, '2026-10-21', res);
  assert.equal(wed.active.changes?.['2026-10-21']?.workoutId, 'sweet-spot-2x20');
  assert.match(wed.active.changes!['2026-10-21'].why, /Moved from Tuesday/);
  const e = entryFor(wed.active, t, '2026-10-21')!;
  assert.equal(e.day.workoutId, 'sweet-spot-2x20');
  assert.equal(e.changed?.from, null);
  assert.ok(schedule(wed.active, t).some((x) => x.date === '2026-10-21'));

  // ridden on Wednesday: the change stays for History and the day counts as done, nothing moves again
  const rodeWed = [...week1, { start: at('2026-10-21'), workoutId: 'sweet-spot-2x20', tss: 74 }];
  const thu = adapt(wed.active, t, rodeWed, '2026-10-22', res);
  assert.equal(thu.active.changes?.['2026-10-21']?.workoutId, 'sweet-spot-2x20');
  assert.equal(Object.keys(thu.active.changes ?? {}).length, 1);
  assert.equal(completion(schedule(thu.active, t), rodeWed, '2026-10-22').get('2026-10-21'), 'done');

  // no free day left that isn't next to Saturday's hard session: left out, with a note
  const fri = adapt(plan, t, week1, '2026-10-23', res);
  assert.equal(fri.active.changes, undefined);
  assert.match(fri.notes[0], /Tuesday's Sweet Spot 2x20 is left out/);

  // an unplanned hard ride on Friday: Saturday's hard session becomes endurance
  const rodeTue = [...week1, { start: at('2026-10-20'), workoutId: 'sweet-spot-2x20', tss: 74 }];
  const extra = adapt(plan, t, [...rodeTue, { start: at('2026-10-23'), tss: 120 }], '2026-10-23', res);
  assert.equal(extra.active.changes?.['2026-10-24']?.workoutId, 'endurance-60');
  assert.match(extra.active.changes!['2026-10-24'].why, /today's hard ride \(TSS 120\)/);
  // the planned session ridden hard is not extra
  assert.equal(adapt(plan, t, [...rodeTue, { start: at('2026-10-22'), workoutId: 'endurance-60', tss: 95 }], '2026-10-23', res).active.changes, undefined);

  // a block of very hard days on little history: recovery before the next hard session
  const block = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23'].map((d) => ({ start: at(d), tss: 160 }));
  const tired = adapt(plan, t, block, '2026-10-23', res);
  assert.ok(tired.form.form < -25, `form ${tired.form.form}`);
  assert.equal(tired.active.changes?.['2026-10-24']?.workoutId, 'recovery-30');
  // tired: the missed Tuesday session is not moved
  assert.ok(!Object.values(tired.active.changes ?? {}).some((c) => c.workoutId === 'sweet-spot-2x20'));

  // fitness and fatigue settle on a steady daily load
  const steady = Array.from({ length: 180 }, (_, i) => ({ start: at('2026-04-01') + i * 86400000, tss: 100 }));
  const load = trainingLoad(steady, '2026-09-27');
  assert.ok(load.fitness > 95 && load.fitness < 100, `fitness ${load.fitness}`);
  assert.ok(Math.abs(load.fatigue - 100) < 0.5, `fatigue ${load.fatigue}`);
  assert.deepEqual(trainingLoad([], '2026-10-01'), { fitness: 0, fatigue: 0, form: 0 });
}

// 8. a plan towards an event: it ends in the event's week, easy the day before, nothing from the day on
{
  const t = PLAN_TEMPLATES.find((x) => x.id === 'ftp-builder')!;
  const goal = { name: 'Gaisbergrennen', date: '2026-12-13' };
  const early = planForGoal(t, goal, '2026-10-29');
  assert.deepEqual(early, { templateId: 'ftp-builder', start: '2026-11-02', goal });
  const s = schedule(early, t);
  assert.equal(s[0].date, '2026-11-02');
  assert.equal(s[s.length - 1].date, '2026-12-12');
  assert.equal(s[s.length - 1].day.workoutId, 'easy-spin'); // was recovery-30 the day before
  assert.match(s[s.length - 1].day.note!, /before Gaisbergrennen/);
  assert.equal(entryFor(early, t, '2026-12-13'), null); // the ramp test on event day is gone
  // joined late: starts today, the weeks still count from the Monday that ends in the event's week
  const late = planForGoal(t, goal, '2026-11-18');
  assert.equal(late.start, '2026-11-18');
  assert.equal(late.weekZero, '2026-11-02');
  assert.equal(entryFor(late, t, '2026-11-24')?.day.workoutId, 'easy-spin'); // week 4 (Recovery week), Tuesday
  assert.equal(entryFor(late, t, '2026-11-17'), null); // before joining
}

// 9. which route covers a session: ride time from the profile at the session's power
{
  const prof = (km: number, grade: number) => {
    const dist: number[] = [], ele: number[] = [];
    for (let d = 0; d <= km * 1000; d += 50) {
      dist.push(d);
      ele.push(500 + (d * grade) / 100);
    }
    return { dist, ele };
  };
  const flat = rideTime(prof(10, 0), 200, 80);
  assert.ok(flat > 900 && flat < 1300, `flat ${flat}`);
  const climb = rideTime(prof(10, 7), 250, 80);
  assert.ok(climb > 1800 && climb < 3000, `climb ${climb}`);
  const opts = [
    { id: 'short', name: 'Short climb', category: 'climb', profile: prof(4, 7) },
    { id: 'long', name: 'Long climb', category: 'climb', profile: prof(12, 7) },
    { id: 'flat', name: 'Flat loop', category: 'flat', profile: prof(15, 0) },
  ];
  const t = (id: string) => rideTime(opts.find((o) => o.id === id)!.profile, 250, 80);
  assert.deepEqual(pickRoutes(opts, t('short') * 1.05, 250, 80, 'climb')?.ids, ['short']);
  assert.deepEqual(pickRoutes(opts, t('short') * 2, 250, 80, 'climb')?.ids, ['long']);
  // longer than any one climb: the long one, then the short one queued
  const pair = pickRoutes(opts, t('long') + t('short') * 0.8, 250, 80, 'climb')!;
  assert.deepEqual(pair.ids, ['long', 'short']);
  assert.deepEqual(pickRoutes(opts, 600, 250, 80, 'flat')?.ids, ['flat']);
  assert.equal(pickRoutes([], 600, 250, 80), null);
}

// 10. one line of feedback on the hard intervals
{
  const w: Workout = {
    id: 'test-2x4', name: '2x4', category: 'threshold', messages: [], duration: 1200, tss: 50, intensityFactor: 0.85, source: 'builtin',
    steps: [
      { kind: 'warmup', duration: 300, start: 0.5, end: 0.6 },
      { kind: 'on', duration: 240, start: 1, end: 1 },
      { kind: 'off', duration: 120, start: 0.5, end: 0.5 },
      { kind: 'on', duration: 240, start: 1, end: 1 },
      { kind: 'cooldown', duration: 300, start: 0.6, end: 0.4 },
    ],
  };
  const ride = (second: number, from = 0, len = 1200): RideRecord => ({
    id: 'r', name: 'x', routeId: 'x', workoutId: w.id, start: 0, laps: [], ftp: 250, weight: 75, workoutFrom: from || undefined,
    samples: Array.from({ length: len }, (_, i) => {
      const at = i + from;
      return { t: i * 1000, lat: 0, lon: 0, alt: 0, distance: 0, speed: 8, power: at >= 660 && at < 900 ? second : 250 };
    }),
  });
  assert.equal(intervalFeedback(ride(250), w), 'On target in both intervals.');
  assert.match(intervalFeedback(ride(220), w)!, /^Interval 2 faded to 88 %/);
  assert.equal(intervalFeedback(ride(290), w), 'Both intervals at 108 % of target on average.');
  // a queued route carried the workout on from second 600: only the second interval is in this ride
  assert.equal(intervalFeedback(ride(250, 600, 600), w), 'On target in 1 of 2 intervals.');
  assert.equal(intervalFeedback({ ...ride(250), workoutId: 'other' }, w), null);
}

console.log('training tests passed');
