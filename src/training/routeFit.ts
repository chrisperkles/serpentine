// Which route covers a planned session. Zwift's Coach picks "which activity fulfils a session"; here it is the
// route that lasts as long as the workout at its average power (same physics as the ride, from the route's
// elevation profile), or two routes, the second one queued.

import { DEFAULT_PHYSICS, steadySpeed } from '../sim/physics.ts';
import type { Workout } from '../workouts/types.ts';
import type { PlanTerrain } from './plans.ts';

export interface RouteOption {
  id: string;
  name: string;
  category?: string;
  profile: { dist: ArrayLike<number>; ele: ArrayLike<number> };
}

export interface RoutePick {
  /** First route, then the ones to queue. */
  ids: string[];
  names: string[];
  /** Estimated riding time, all routes. */
  seconds: number;
}

/** Seconds to ride a profile once at a constant power. */
export function rideTime(profile: RouteOption['profile'], power: number, mass: number): number {
  const { dist, ele } = profile;
  const p = { ...DEFAULT_PHYSICS, mass };
  let t = 0;
  let a = 0;
  // 100 m pieces: profile points are uneven and their grades noisy
  for (let i = 1; i < dist.length; i++) {
    const span = dist[i] - dist[a];
    if (span < 100 && i < dist.length - 1) continue;
    if (span > 0) t += span / Math.max(0.5, steadySpeed(power, ((ele[i] - ele[a]) / span) * 100, (ele[i] + ele[a]) / 2, p));
    a = i;
  }
  return t;
}

/** A workout's average target power, W; free-ride and all-out steps count as 60 % of FTP. */
export function averagePower(w: Workout, ftp: number): number {
  let sum = 0;
  for (const s of w.steps) sum += s.duration * (s.kind === 'free' || s.kind === 'maxeffort' ? 0.6 : (s.start + s.end) / 2);
  return (sum / Math.max(1, w.duration)) * ftp;
}

const fits = (r: RouteOption, terrain: PlanTerrain | undefined) =>
  terrain === 'climb' ? r.category === 'climb' : terrain === 'flat' ? r.category !== 'climb' : true;

/**
 * The shortest route that lasts at least 90 % of the session (a climb that runs out turns you round mid-interval),
 * else the shortest pair that does, else the longest route.
 */
export function pickRoutes(
  options: RouteOption[], seconds: number, power: number, mass: number, terrain?: PlanTerrain,
): RoutePick | null {
  const c = options
    .filter((r) => fits(r, terrain))
    .map((r) => ({ r, t: rideTime(r.profile, power, mass) }))
    .filter((x) => x.t > 60);
  if (!c.length) return null;
  const pick = (xs: typeof c): RoutePick => ({ ids: xs.map((x) => x.r.id), names: xs.map((x) => x.r.name), seconds: xs.reduce((s, x) => s + x.t, 0) });
  const one = c.filter((x) => x.t >= seconds * 0.9).sort((a, b) => a.t - b.t)[0];
  if (one) return pick([one]);
  let pair: [typeof c[number], typeof c[number]] | null = null;
  for (const a of c) {
    for (const b of c) {
      const t = a.t + b.t;
      if (a !== b && t >= seconds * 0.9 && (!pair || t < pair[0].t + pair[1].t)) pair = a.t >= b.t ? [a, b] : [b, a];
    }
  }
  return pick(pair ?? [c.reduce((a, b) => (b.t > a.t ? b : a))]);
}
