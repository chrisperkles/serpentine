// Route model: raw lon/lat polyline → evenly resampled, smoothed path in world space
// with DEM-derived elevation, gradient, heading and curvature.

import { DEM_MAX_Z, elevationAtMercSync, localDemCovers, localDetailZoom, preloadDemBest, preloadDemForPoints } from './elevation.ts';
import { lonLatToMerc, makeFrame, mercToLonLat, mercToWorld, type WorldFrame } from './mercator.ts';

export type RouteCategory = 'climb' | 'rolling' | 'flat' | 'city';

export interface RouteData {
  id: string;
  name: string;
  region?: string;
  category?: RouteCategory;
  /** Ends where it starts: ride laps instead of turning around. */
  loop?: boolean;
  source: 'brouter' | 'gpx' | 'drawn';
  /** [lon, lat, ele?] */
  coords: number[][];
  /** Tunnel spans [from, to] in metres along the route (from OSM tunnel=yes). */
  tunnels?: [number, number][];
  /** Spans [from, to] where the DEM is the rock above a road cutting, not the road (a false ramp). */
  cuts?: [number, number][];
  /**
   * Where the road passes under itself, like Sa Calobra's Nus de la Corbata: [lon, lat] near the crossing.
   * The earlier pass along the route goes under, `clearance` metres below the later one; `model` is the
   * bridge (public/models), its origin on the lower road in the middle of the passage.
   */
  underpasses?: { lon: number; lat: number; clearance: number; model?: string }[];
  /**
   * Point-to-point routes: how the rider turns at each end ([lon, lat] from the end point
   * around a loop back to it; scripts/bake-turnarounds.mjs). Missing → a turning circle.
   */
  turnEnd?: number[][];
  turnStart?: number[][];
  /**
   * An easy approach on real roads (scripts/bake-leadin.py): it replaces coords[0..join] and has
   * its own turnaround at its first point. Ridden only when withLeadIn() puts it in front.
   */
  leadIn?: { name: string; coords: number[][]; join: number; turnStart?: number[][] };
  /**
   * Set by withLeadIn(): coords[index] is where the route proper starts; `cut` is how many metres
   * of the original route (haversine) the lead-in replaced.
   */
  climbFrom?: { index: number; name: string; cut: number };
}

/**
 * The turnaround at one end of a point-to-point route, sampled like the route itself. The
 * rider rides it with s beyond the end (turnEnd: s = length + u) or below the start
 * (turnStart: s = -u), then rejoins the road `rejoin` metres back from the end.
 * turnStart stores heading + π and negated grade, because the rider rides it with dir = -1.
 */
export interface TurnPath {
  n: number;
  length: number;
  /** Samples of the loop itself (the rest is the rejoin leg on the main road). */
  loopN: number;
  rejoin: number;
  x: Float32Array;
  z: Float32Array;
  ele: Float32Array;
  grade: Float32Array;
  heading: Float32Array;
  radius: Float32Array;
  lon: Float64Array;
  lat: Float64Array;
}

export interface Route {
  id: string;
  name: string;
  region?: string;
  category: RouteCategory;
  loop: boolean;
  frame: WorldFrame;
  step: number; // metres between samples
  n: number;
  length: number;
  lon: Float64Array;
  lat: Float64Array;
  x: Float32Array;
  z: Float32Array;
  ele: Float32Array; // metres above sea level, smoothed
  grade: Float32Array; // percent
  heading: Float32Array; // radians, 0 = north (-Z), clockwise
  radius: Float32Array; // turn radius in metres (large on straights)
  gain: number;
  minEle: number;
  maxEle: number;
  /** World-space bounds [minX, minZ, maxX, maxZ]. */
  bounds: [number, number, number, number];
  /** Tunnel spans [from, to] in metres along the route. */
  tunnels: [number, number][];
  underpasses: Underpass[];
  turnEnd: TurnPath | null;
  turnStart: TurnPath | null;
  /** The profile and the ground beside the road come from fine local tiles (1 m lidar), not the 10 m global DEM. */
  detailDem: boolean;
  /** Metres of easy lead-in before the route proper (0 without one) and where it starts. */
  leadIn: number;
  leadInFrom?: string;
  /** Add to a distance measured along the route without its lead-in (Strava segments). */
  leadInShift: number;
}

export const ROUTE_STEP = 4;

export interface Underpass {
  /** Metres along the route where the road passes under, and where it crosses over that spot. */
  s: number;
  over: number;
  clearance: number;
  model?: string;
}

function smooth(src: Float32Array, radius: number, passes = 1): Float32Array {
  let a = src;
  for (let p = 0; p < passes; p++) {
    const out = new Float32Array(a.length);
    let sum = 0;
    let count = 0;
    // running window, edges shrink symmetrically so endpoints stay put
    for (let i = 0; i < a.length; i++) {
      const r = Math.min(radius, i, a.length - 1 - i);
      sum = 0;
      count = 0;
      for (let j = i - r; j <= i + r; j++) {
        sum += a[j];
        count++;
      }
      out[i] = sum / count;
    }
    a = out;
  }
  return a;
}

export async function buildRoute(data: RouteData): Promise<Route> {
  const raw = data.coords.filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1]));
  if (raw.length < 2) throw new Error('Route needs at least two points');
  const frame = makeFrame(raw[0][0], raw[0][1]);

  // project + drop duplicates
  const px: number[] = [];
  const pz: number[] = [];
  const pe: number[] = [];
  let climbAt = 0;
  for (let k = 0; k < raw.length; k++) {
    const c = raw[k];
    const [mx, my] = lonLatToMerc(c[0], c[1]);
    const [wx, wz] = mercToWorld(frame, mx, my);
    const last = px.length - 1;
    if (k === data.climbFrom?.index) climbAt = Math.max(0, last);
    if (last >= 0 && Math.hypot(wx - px[last], wz - pz[last]) < 0.5) continue;
    if (k === data.climbFrom?.index) climbAt = last + 1;
    px.push(wx);
    pz.push(wz);
    pe.push(c[2] ?? NaN);
  }
  const cum = [0];
  for (let i = 1; i < px.length; i++) cum.push(cum[i - 1] + Math.hypot(px[i] - px[i - 1], pz[i] - pz[i - 1]));
  const length = cum[cum.length - 1];
  const leadIn = data.climbFrom ? cum[climbAt] : 0;
  const step = ROUTE_STEP;
  const n = Math.max(2, Math.floor(length / step) + 1);

  // resample evenly
  let x: Float32Array = new Float32Array(n);
  let z: Float32Array = new Float32Array(n);
  const gpxEle = new Float32Array(n);
  let seg = 0;
  for (let i = 0; i < n; i++) {
    const s = Math.min(i * step, length);
    while (seg < cum.length - 2 && cum[seg + 1] < s) seg++;
    const span = cum[seg + 1] - cum[seg] || 1;
    const t = (s - cum[seg]) / span;
    x[i] = px[seg] + (px[seg + 1] - px[seg]) * t;
    z[i] = pz[seg] + (pz[seg + 1] - pz[seg]) * t;
    gpxEle[i] = pe[seg] + (pe[seg + 1] - pe[seg]) * t;
  }
  // light planar smoothing removes GPS zig-zag but keeps hairpins
  x = smooth(x, 2, 2);
  z = smooth(z, 2, 2);

  const lon = new Float64Array(n);
  const lat = new Float64Array(n);
  const merc: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const mx = x[i] / frame.k + frame.mx0;
    const my = -z[i] / frame.k + frame.my0;
    merc.push([mx, my]);
    lon[i] = (mx / 6378137) * (180 / Math.PI);
    lat[i] = (2 * Math.atan(Math.exp(my / 6378137)) - Math.PI / 2) * (180 / Math.PI);
  }

  // elevation from the DEM (consistent with the rendered terrain), GPX as fallback
  // high-resolution local DEM bakes are used at full zoom
  // (finer local tiles, e.g. 1 m lidar, give the road's profile as it is; see Terrain.flatten for the ground beside it)
  const detailZ = await localDetailZoom(merc);
  const demZ = detailZ || ((await localDemCovers(merc, DEM_MAX_Z)) ? DEM_MAX_Z : Math.min(DEM_MAX_Z - 1, 14));
  await preloadDemForPoints(merc, demZ);
  if (detailZ) {
    // the turnaround loops at both ends reach past the route's own points, and the fine tiles are small
    for (const [mx, my] of [merc[0], merc[merc.length - 1]]) await preloadDemBest(mx - 600, my - 600, mx + 600, my + 600);
  }
  let ele: Float32Array = new Float32Array(n);
  let missing = 0;
  for (let i = 0; i < n; i++) {
    const h = elevationAtMercSync(merc[i][0], merc[i][1], demZ);
    if (Number.isFinite(h)) ele[i] = h;
    else {
      ele[i] = gpxEle[i];
      missing++;
    }
  }
  if (missing === n && !Number.isFinite(gpxEle[0])) ele.fill(0);
  // tunnels: the DEM is the mountain above, and in the cuts leading to the portals it is still the
  // hillside above the road (Formentor climbed 87 m into its tunnel); `cuts` mark other places where the
  // DEM is the rock above a cutting. The road takes the profile's lower hull there.
  const tunnels = (data.tunnels ?? []).map(([a, b]) => [Math.min(a, b), Math.max(a, b)] as [number, number]);
  for (const [a, b] of [...tunnels, ...(data.cuts ?? [])]) lowerHull(ele, step, a, b);
  // DEM on steep hillsides is noisy where the road is cut in; smooth over ~±60 m
  ele = smooth(ele, Math.round(30 / step), 3);
  // the DEM puts both passes of a self-crossing at one height: the lower one drops under the bridge
  // over the 160 m before it, and the loop climbs from there to the bridge deck
  const underpasses = findUnderpasses(data, frame, x, z, step);
  for (const u of underpasses) {
    const iu = Math.round(u.s / step);
    const io = Math.round(u.over / step);
    const i0 = Math.max(0, iu - Math.round(160 / step));
    const deck = ele[io];
    const low = deck - u.clearance;
    for (let i = i0 + 1; i < io; i++) {
      ele[i] = i <= iu ? ele[i0] + ((low - ele[i0]) * (i - i0)) / Math.max(1, iu - i0) : low + ((deck - low) * (i - iu)) / Math.max(1, io - iu);
    }
  }

  const grade = new Float32Array(n);
  const gw = Math.round(20 / step);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - gw);
    const b = Math.min(n - 1, i + gw);
    const g = ((ele[b] - ele[a]) / ((b - a) * step || 1)) * 100;
    grade[i] = Math.max(-25, Math.min(25, g));
  }

  const heading = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    heading[i] = Math.atan2(x[b] - x[a], -(z[b] - z[a]));
  }
  const radius = new Float32Array(n);
  const rw = Math.round(8 / step);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - rw);
    const b = Math.min(n - 1, i + rw);
    let d = heading[b] - heading[a];
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const arc = (b - a) * step;
    radius[i] = Math.abs(d) < 1e-4 ? 1e4 : Math.min(1e4, arc / Math.abs(d));
  }

  let gain = 0;
  let minEle = Infinity;
  let maxEle = -Infinity;
  let ref = ele[0];
  for (let i = 0; i < n; i++) {
    minEle = Math.min(minEle, ele[i]);
    maxEle = Math.max(maxEle, ele[i]);
    if (ele[i] > ref + 1) {
      gain += ele[i] - ref;
      ref = ele[i];
    } else if (ele[i] < ref - 1) ref = ele[i];
  }

  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, x[i]);
    maxX = Math.max(maxX, x[i]);
    minZ = Math.min(minZ, z[i]);
    maxZ = Math.max(maxZ, z[i]);
  }

  return {
    id: data.id,
    name: data.name,
    region: data.region,
    category: data.category ?? inferCategory(gain, (n - 1) * step, maxEle - minEle),
    loop: data.loop ?? false,
    frame,
    step,
    n,
    length: (n - 1) * step,
    lon,
    lat,
    x,
    z,
    ele,
    grade,
    heading,
    radius,
    gain,
    minEle,
    maxEle,
    bounds: [minX, minZ, maxX, maxZ],
    tunnels,
    underpasses,
    ...turns(data, frame, { x, z, ele, n, step }, demZ),
    detailDem: detailZ > 0,
    leadIn,
    leadInFrom: data.climbFrom?.name,
    leadInShift: data.climbFrom ? leadIn - data.climbFrom.cut : 0,
  };
}

/**
 * Replace the profile across [a, b] by its lower hull from 150 m before to 150 m after: the road runs
 * straight under every bump, never above the ground either side. A tunnel through a summit (the road
 * climbing to one portal and falling from the other) would lose its top; no preset has one yet.
 */
function lowerHull(ele: Float32Array, step: number, a: number, b: number) {
  const n = ele.length;
  const lo = Math.max(0, Math.floor((a - 150) / step));
  const hi = Math.min(n - 1, Math.ceil((b + 150) / step));
  const hull: number[] = [];
  for (let i = lo; i <= hi; i++) {
    // drop the last vertex while it lies on or above the line from the one before it to i
    while (hull.length >= 2) {
      const p = hull[hull.length - 2], q = hull[hull.length - 1];
      if ((ele[q] - ele[p]) * (i - p) >= (ele[i] - ele[p]) * (q - p)) hull.pop();
      else break;
    }
    hull.push(i);
  }
  const ia = Math.floor(a / step), ib = Math.ceil(b / step);
  let k0 = 0;
  while (k0 + 1 < hull.length && hull[k0 + 1] <= ia) k0++;
  let k1 = hull.length - 1;
  while (k1 - 1 >= 0 && hull[k1 - 1] >= ib) k1--;
  for (let k = k0; k < k1; k++) {
    const p = hull[k], q = hull[k + 1];
    for (let i = p + 1; i < q; i++) ele[i] = ele[p] + ((ele[q] - ele[p]) * (i - p)) / (q - p);
  }
}

/** Where the resampled path crosses itself near each `underpasses` point (the earlier pass goes under). */
function findUnderpasses(data: RouteData, frame: WorldFrame, x: Float32Array, z: Float32Array, step: number): Underpass[] {
  const out: Underpass[] = [];
  for (const u of data.underpasses ?? []) {
    const [ux, uz] = mercToWorld(frame, ...lonLatToMerc(u.lon, u.lat));
    const near: number[] = [];
    for (let i = 0; i < x.length - 1; i++) if (Math.hypot(x[i] - ux, z[i] - uz) < 60) near.push(i);
    let found: Underpass | null = null;
    for (const i of near) {
      for (const j of near) {
        if (j <= i + 3) continue;
        const rx = x[i + 1] - x[i], rz = z[i + 1] - z[i];
        const qx = x[j + 1] - x[j], qz = z[j + 1] - z[j];
        const den = rx * qz - rz * qx;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((x[j] - x[i]) * qz - (z[j] - z[i]) * qx) / den;
        const v = ((x[j] - x[i]) * rz - (z[j] - z[i]) * rx) / den;
        if (t >= 0 && t <= 1 && v >= 0 && v <= 1) found = { s: (i + t) * step, over: (j + v) * step, clearance: u.clearance, model: u.model };
      }
    }
    if (found) out.push(found);
    else console.warn(`[route] ${data.id}: no self-crossing near underpass ${u.lon},${u.lat}`);
  }
  return out;
}

const REJOIN = 24;

/** Build both turnarounds (only for point-to-point routes). */
function turns(
  data: RouteData,
  frame: WorldFrame,
  main: { x: Float32Array; z: Float32Array; ele: Float32Array; n: number; step: number },
  demZ: number,
): { turnEnd: TurnPath | null; turnStart: TurnPath | null } {
  if (data.loop) return { turnEnd: null, turnStart: null };
  const { x, z, ele, n, step } = main;
  const rj = Math.min(REJOIN, (n - 1) * step * 0.25);
  const k = Math.max(1, Math.round(rj / step));
  // end: arrive heading along the route; rejoin = the last k samples, backwards
  const endHead = Math.atan2(x[n - 1] - x[n - 3], -(z[n - 1] - z[n - 3]));
  const endLoop = data.turnEnd?.length ? toWorld(data.turnEnd, frame) : turningCircle(x[n - 1], z[n - 1], endHead);
  const endRejoin: [number, number][] = [];
  for (let i = 1; i <= k; i++) endRejoin.push([x[n - 1 - i], z[n - 1 - i]]);
  const turnEnd = samplePath(endLoop, endRejoin, frame, demZ, ele[n - 1], ele[n - 1 - k], false, k * step);
  // start: arrive heading down the route (towards s = 0); rejoin = the first k samples, forwards
  const startHead = Math.atan2(x[0] - x[2], -(z[0] - z[2]));
  const startLoop = data.turnStart?.length ? toWorld(data.turnStart, frame) : turningCircle(x[0], z[0], startHead);
  const startRejoin: [number, number][] = [];
  for (let i = 1; i <= k; i++) startRejoin.push([x[i], z[i]]);
  const turnStart = samplePath(startLoop, startRejoin, frame, demZ, ele[0], ele[k], true, k * step);
  return { turnEnd, turnStart };
}

function toWorld(ll: number[][], frame: WorldFrame): [number, number][] {
  return ll.map((c) => {
    const [mx, my] = lonLatToMerc(c[0], c[1]);
    return mercToWorld(frame, mx, my) as [number, number];
  });
}

/** Turning circle ahead of (x, z): keep right, turn left round it, back to the start point. */
function turningCircle(x0: number, z0: number, heading: number): [number, number][] {
  const fx = Math.sin(heading), fz = -Math.cos(heading); // forward
  const lx = -fz, lz = fx; // left… in world terms with -Z north: left of forward
  const ctrl: [number, number][] = [[-5, 0], [0, 0], [5, -2.4], [12, -6], [19, -3.2], [21, 3], [16, 7.5], [9, 6.2], [4, 2.6], [0, 0], [-5, 0]];
  const w = ctrl.map(([a, b]) => [x0 + fx * a - lx * b, z0 + fz * a - lz * b] as [number, number]);
  const out: [number, number][] = [];
  for (let i = 1; i < w.length - 2; i++) {
    const [p0, p1, p2, p3] = [w[i - 1], w[i], w[i + 1], w[i + 2]];
    for (let s = 0; s < 6; s++) {
      const t = s / 6, t2 = t * t, t3 = t2 * t;
      const c = (a: number, b: number, cc: number, d: number) =>
        0.5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t2 + (-a + 3 * b - 3 * cc + d) * t3);
      out.push([c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push([x0, z0]);
  return out;
}

/** Resample loop + rejoin leg at ROUTE_STEP with DEM elevation pinned to the road at both ends. */
function samplePath(
  loop: [number, number][],
  rejoin: [number, number][],
  frame: WorldFrame,
  demZ: number,
  eleStart: number,
  eleEnd: number,
  reversed: boolean,
  rejoinLen: number,
): TurnPath {
  const pts = [...loop, ...rejoin];
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const length = cum[cum.length - 1];
  const loopLen = cum[loop.length - 1];
  const step = ROUTE_STEP;
  const n = Math.max(3, Math.floor(length / step) + 1);
  const x = new Float32Array(n), z = new Float32Array(n), ele = new Float32Array(n);
  const lon = new Float64Array(n), lat = new Float64Array(n);
  let seg = 0;
  for (let i = 0; i < n; i++) {
    const s = Math.min((i * length) / (n - 1), length);
    while (seg < cum.length - 2 && cum[seg + 1] < s) seg++;
    const t = (s - cum[seg]) / (cum[seg + 1] - cum[seg] || 1);
    x[i] = pts[seg][0] + (pts[seg + 1][0] - pts[seg][0]) * t;
    z[i] = pts[seg][1] + (pts[seg + 1][1] - pts[seg][1]) * t;
    const mx = x[i] / frame.k + frame.mx0, my = -z[i] / frame.k + frame.my0;
    [lon[i], lat[i]] = mercToLonLat(mx, my);
    const h = elevationAtMercSync(mx, my, demZ);
    ele[i] = Number.isFinite(h) ? h : NaN;
  }
  // the loop leaves the route's end point and comes back to it: pin both of its ends to the road
  // (pinning only the path's far end left a step where the loop met the asphalt again); the
  // rejoin leg is the route itself, ridden back. The middle follows the DEM's shape, measured
  // from the end point: the smoothed profile ends metres below the raw DEM on a climb, and the
  // loop stood on a plateau above the road
  const d0 = Number.isFinite(ele[0]) ? ele[0] - eleStart : 0;
  for (let i = 0; i < n; i++) if (Number.isFinite(ele[i])) ele[i] -= d0;
  for (let i = 0; i < n; i++) {
    const s = (i * length) / (n - 1);
    if (s >= loopLen) {
      ele[i] = eleStart + (eleEnd - eleStart) * ((s - loopLen) / (length - loopLen || 1));
      continue;
    }
    if (!Number.isFinite(ele[i])) ele[i] = eleStart;
    const pin = Math.max(1 - s / 12, 0, 1 - (loopLen - s) / 12);
    ele[i] = ele[i] + (eleStart - ele[i]) * pin;
  }
  const eleS = smooth(ele, 3, 2);
  const heading = new Float32Array(n), grade = new Float32Array(n), radius = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    heading[i] = Math.atan2(x[b] - x[a], -(z[b] - z[a]));
    const ga = Math.max(0, i - 3), gb = Math.min(n - 1, i + 3);
    grade[i] = Math.max(-25, Math.min(25, ((eleS[gb] - eleS[ga]) / ((gb - ga) * (length / (n - 1)) || 1)) * 100));
  }
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 2), b = Math.min(n - 1, i + 2);
    let d = heading[b] - heading[a];
    d = Math.atan2(Math.sin(d), Math.cos(d));
    radius[i] = Math.abs(d) < 1e-4 ? 1e4 : Math.min(1e4, ((b - a) * (length / (n - 1))) / Math.abs(d));
  }
  if (reversed) {
    // ridden with dir = -1: consumers add π to the heading and multiply grade by dir
    for (let i = 0; i < n; i++) {
      heading[i] += Math.PI;
      grade[i] = -grade[i];
    }
  }
  return {
    n, length, loopN: Math.min(n, Math.round((loopLen / length) * (n - 1)) + 1), rejoin: rejoinLen,
    x, z, ele: eleS, grade, heading, radius, lon, lat,
  };
}

export interface RoutePoint {
  x: number;
  z: number;
  ele: number;
  grade: number;
  heading: number;
  radius: number;
  lon: number;
  lat: number;
}

function inferCategory(gain: number, length: number, range: number): RouteCategory {
  const perKm = gain / Math.max(length / 1000, 0.1);
  if (range > 350 && perKm > 35) return 'climb';
  if (perKm > 12) return 'rolling';
  return 'flat';
}

/** Interpolated route state at distance s (clamped, or wrapped on loops). */
export function pointAt(r: Route, s: number, out: Partial<RoutePoint> = {}): RoutePoint {
  if (r.loop) s = ((s % r.length) + r.length) % r.length;
  else if (s > r.length && r.turnEnd) return turnPoint(r.turnEnd, s - r.length, out);
  else if (s < 0 && r.turnStart) return turnPoint(r.turnStart, -s, out);
  const f = Math.min(Math.max(s / r.step, 0), r.n - 1.0001);
  const i = Math.floor(f);
  const t = f - i;
  const lerp = (a: ArrayLike<number>) => a[i] + (a[i + 1] - a[i]) * t;
  let dh = r.heading[i + 1] - r.heading[i];
  dh = Math.atan2(Math.sin(dh), Math.cos(dh));
  out.x = lerp(r.x);
  out.z = lerp(r.z);
  out.ele = lerp(r.ele);
  out.grade = lerp(r.grade);
  out.heading = r.heading[i] + dh * t;
  out.radius = lerp(r.radius);
  out.lon = lerp(r.lon);
  out.lat = lerp(r.lat);
  return out as RoutePoint;
}

/** Spatial hash over route samples for fast nearest-distance queries. */
export class RouteIndex {
  private cell: number;
  private grid = new Map<number, number[]>();
  private route: Route;
  /** Turnaround samples (both ends): x, z, ele, path id (segments only join within one path). */
  private ex: number[] = [];
  private ez: number[] = [];
  private ee: number[] = [];
  private ep: number[] = [];
  private egrid = new Map<number, number[]>();

  constructor(route: Route, cell = 40) {
    this.route = route;
    this.cell = cell;
    for (let i = 0; i < route.n; i++) {
      const k = this.key(Math.floor(route.x[i] / cell), Math.floor(route.z[i] / cell));
      let list = this.grid.get(k);
      if (!list) this.grid.set(k, (list = []));
      list.push(i);
    }
    [route.turnEnd, route.turnStart].forEach((t, id) => {
      if (!t) return;
      // the rejoin leg lies on the road itself; the loop is what needs indexing
      for (let i = 0; i < t.loopN; i++) {
        const j = this.ex.length;
        this.ex.push(t.x[i]);
        this.ez.push(t.z[i]);
        this.ee.push(t.ele[i]);
        this.ep.push(id);
        const k = this.key(Math.floor(t.x[i] / cell), Math.floor(t.z[i] / cell));
        let list = this.egrid.get(k);
        if (!list) this.egrid.set(k, (list = []));
        list.push(j);
      }
    });
  }

  private key(cx: number, cz: number) {
    return (cx + 32768) * 65536 + (cz + 32768);
  }

  /**
   * Nearest point on the route or its turnarounds: sample index, distance, fractional index
   * along the main polyline, road elevation there, and whether it lies on a turnaround
   * (then index/f point at the route end it belongs to).
   */
  nearest(x: number, z: number, maxDist: number): { index: number; dist: number; f: number; ele: number; turn: boolean } {
    const r = this.route;
    const c = this.cell;
    const reach = Math.ceil(maxDist / c);
    const cx = Math.floor(x / c);
    const cz = Math.floor(z / c);
    let best = -1;
    let bestD = maxDist * maxDist;
    for (let dz = -reach; dz <= reach; dz++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const list = this.grid.get(this.key(cx + dx, cz + dz));
        if (!list) continue;
        for (const i of list) {
          const ddx = r.x[i] - x;
          const ddz = r.z[i] - z;
          const d = ddx * ddx + ddz * ddz;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
      }
    }
    // turnarounds
    let eBest = -1;
    let eD = Math.min(bestD, maxDist * maxDist);
    if (this.ex.length) {
      for (let dz = -reach; dz <= reach; dz++) {
        for (let dx = -reach; dx <= reach; dx++) {
          const list = this.egrid.get(this.key(cx + dx, cz + dz));
          if (!list) continue;
          for (const j of list) {
            const d = (this.ex[j] - x) ** 2 + (this.ez[j] - z) ** 2;
            if (d < eD) {
              eD = d;
              eBest = j;
            }
          }
        }
      }
    }
    if (eBest >= 0) {
      let dist = Math.sqrt(eD);
      let ele = this.ee[eBest];
      for (const j of [eBest - 1, eBest]) {
        if (j < 0 || j + 1 >= this.ex.length || this.ep[j] !== this.ep[j + 1]) continue;
        const ax = this.ex[j], az = this.ez[j];
        const bx = this.ex[j + 1] - ax, bz = this.ez[j + 1] - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * bx + (z - az) * bz) / (bx * bx + bz * bz || 1)));
        const d = Math.hypot(x - ax - bx * t, z - az - bz * t);
        if (d < dist) {
          dist = d;
          ele = this.ee[j] + (this.ee[j + 1] - this.ee[j]) * t;
        }
      }
      const end = this.ep[eBest] === 0 ? r.n - 1 : 0;
      return { index: end, dist, f: end, ele, turn: true };
    }
    if (best < 0) return { index: -1, dist: Infinity, f: -1, ele: NaN, turn: false };
    // refine against the neighbouring segments
    let dist = Math.sqrt(bestD);
    let f = best;
    for (const j of [best - 1, best]) {
      if (j < 0 || j + 1 >= r.n) continue;
      const ax = r.x[j], az = r.z[j];
      const bx = r.x[j + 1] - ax, bz = r.z[j + 1] - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * bx + (z - az) * bz) / (bx * bx + bz * bz || 1)));
      const d = Math.hypot(x - ax - bx * t, z - az - bz * t);
      if (d < dist) {
        dist = d;
        f = j + t;
      }
    }
    return { index: best, dist, f, ele: this.eleAt(f), turn: false };
  }

  /** Route elevation at a fractional sample index. */
  eleAt(f: number): number {
    const r = this.route;
    const i = Math.min(Math.max(Math.floor(f), 0), r.n - 2);
    const t = Math.min(Math.max(f - i, 0), 1);
    return r.ele[i] + (r.ele[i + 1] - r.ele[i]) * t;
  }
}

function turnPoint(p: TurnPath, u: number, out: Partial<RoutePoint>): RoutePoint {
  const f = Math.min(Math.max((u / p.length) * (p.n - 1), 0), p.n - 1.0001);
  const i = Math.floor(f);
  const t = f - i;
  const lerp = (a: ArrayLike<number>) => a[i] + (a[i + 1] - a[i]) * t;
  let dh = p.heading[i + 1] - p.heading[i];
  dh = Math.atan2(Math.sin(dh), Math.cos(dh));
  out.x = lerp(p.x);
  out.z = lerp(p.z);
  out.ele = lerp(p.ele);
  out.grade = lerp(p.grade);
  out.heading = p.heading[i] + dh * t;
  out.radius = lerp(p.radius);
  out.lon = lerp(p.lon);
  out.lat = lerp(p.lat);
  return out as RoutePoint;
}

/**
 * Move a rider along the route by ds metres (≥ 0) in direction dir. Loops wrap; point-to-point
 * routes ride the turnaround at each end and come back. `turned` tells which end was rounded.
 */
export function advance(
  r: Route, s: number, dir: 1 | -1, ds: number,
): { s: number; dir: 1 | -1; turned: 'end' | 'start' | null; enteredEnd: boolean } {
  const L = r.length;
  let next = s + ds * dir;
  if (r.loop) return { s: ((next % L) + L) % L, dir, turned: null, enteredEnd: s < L && next >= L };
  const enteredEnd = dir === 1 && s < L && next >= L;
  if (dir === 1 && next >= L) {
    const T = r.turnEnd;
    if (!T) return { s: L - (next - L), dir: -1, turned: 'end', enteredEnd };
    if (next >= L + T.length) return { s: L - T.rejoin - (next - L - T.length), dir: -1, turned: 'end', enteredEnd };
    return { s: next, dir, turned: null, enteredEnd };
  }
  if (dir === -1 && next <= 0) {
    const T = r.turnStart;
    if (!T) return { s: -next, dir: 1, turned: 'start', enteredEnd };
    if (next <= -T.length) return { s: T.rejoin + (-next - T.length), dir: 1, turned: 'start', enteredEnd };
    return { s: next, dir, turned: null, enteredEnd };
  }
  return { s: next, dir, turned: null, enteredEnd };
}

/** Where a rider who started at s = 0 is after riding d metres (turnarounds included). */
export function positionAt(r: Route, d: number): { s: number; dir: 1 | -1 } {
  const L = r.length;
  if (r.loop) return { s: ((d % L) + L) % L, dir: 1 };
  if (d < L) return { s: d, dir: 1 };
  const Te = r.turnEnd?.length ?? 0, rE = r.turnEnd?.rejoin ?? 0;
  const Ts = r.turnStart?.length ?? 0, rS = r.turnStart?.rejoin ?? 0;
  const down = L - rE, up = L - rS;
  let x = (d - L) % (Te + down + Ts + up);
  if (x < Te) return { s: L + x, dir: 1 };
  x -= Te;
  if (x < down) return { s: down - x, dir: -1 };
  x -= down;
  if (x < Ts) return { s: -x, dir: -1 };
  x -= Ts;
  return { s: rS + x, dir: 1 };
}

/** Distances (m) of hairpin bends: ≥135° of turning within ~60 m. */
export function findHairpins(r: Route): number[] {
  const out: number[] = [];
  const w = Math.round(30 / r.step);
  let i = w;
  while (i < r.n - w) {
    let acc = 0;
    for (let j = i - w; j < i + w; j++) {
      let s = r.heading[j + 1] - r.heading[j];
      s = Math.atan2(Math.sin(s), Math.cos(s));
      acc += s;
    }
    if (Math.abs(acc) > 2.35) {
      out.push(i * r.step);
      i += w * 2;
    } else i++;
  }
  return out;
}
