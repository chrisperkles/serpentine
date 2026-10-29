// One line after a workout, the way Coach comments in Zwift's Companion app: how the hard intervals went against
// their targets. Sample i of a ride is second (workoutFrom + i) of the workout, close enough while pedalling.

import type { RideRecord } from '../sim/types.ts';
import type { Workout } from '../workouts/types.ts';
import { RAMP_TEST_ID } from './rampTest.ts';

/** Intervals at least this hard (FTP fraction) and this long (s) are the ones that count. */
const WORK = 0.85;
const MIN_LEN = 60;

export function intervalFeedback(rec: RideRecord, w: Workout): string | null {
  if (w.id === RAMP_TEST_ID || rec.workoutId !== w.id) return null;
  const from = rec.workoutFrom ?? 0;
  const ratios: number[] = [];
  let planned = 0;
  let t = 0;
  for (const s of w.steps) {
    const target = ((s.start + s.end) / 2) * rec.ftp;
    const work = s.kind !== 'warmup' && s.kind !== 'cooldown' && s.kind !== 'free' && s.kind !== 'maxeffort' && (s.start + s.end) / 2 >= WORK && s.duration >= MIN_LEN;
    if (work) {
      planned++;
      // skip the first seconds: the trainer and the legs take a moment to get there
      const a = Math.round(t + Math.min(15, s.duration * 0.15)) - from;
      const b = Math.round(t + s.duration) - from;
      if (a >= 0 && b <= rec.samples.length) {
        let sum = 0;
        for (let i = a; i < b; i++) sum += rec.samples[i].power ?? 0;
        ratios.push(sum / Math.max(1, b - a) / target);
      }
    }
    t += s.duration;
  }
  if (!ratios.length) return null;
  const pct = (r: number) => `${Math.round(r * 100)} %`;
  const n = ratios.length;
  const mean = ratios.reduce((a, b) => a + b, 0) / n;
  const part = n < planned ? `${n} of ${planned} intervals` : n === 1 ? 'the interval' : n === 2 ? 'both intervals' : `all ${n} intervals`;
  if (ratios.every((r) => r >= 0.95 && r <= 1.05)) return `On target in ${part}.`;
  if (ratios.every((r) => r > 1.05)) return `Above target in ${part} (${pct(mean)} on average). Your FTP may be higher: a ramp test would tell.`;
  const last = ratios[n - 1];
  if (n >= 2 && last < 0.92 && ratios[0] >= 0.97) {
    return `Interval ${n} faded to ${pct(last)} of its target. Start the first ones a touch easier next time.`;
  }
  if (mean < 0.92) return `${part[0].toUpperCase()}${part.slice(1)} at ${pct(mean)} of target. If they felt hard, your FTP may be set too high.`;
  return `${part[0].toUpperCase()}${part.slice(1)} at ${pct(mean)} of target on average.`;
}
