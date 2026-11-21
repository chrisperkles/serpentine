// Vienna's trams on the Ring: the mapped track (OSM railway=tram) as paved bed and steel rails, and a red-and-white
// low-floor tram built from boxes that runs along the connected track. Track that comes within the carriageway of the
// route is cut out, so nothing lies on the asphalt and no tram crosses the rider's lane.

import * as THREE from 'three';
import type { OsmWorld } from '../geo/osm.ts';
import type { RouteIndex } from '../geo/route.ts';
import { patchMaterial } from './atmosphere.ts';
import { mergeColored } from './Road.ts';

export interface TramLine {
  /** x,z pairs of one connected stretch of track. */
  pts: Float32Array;
  /** Distance along the line at every point (m). */
  cum: Float32Array;
  len: number;
}

/** Cut each mapped track where it enters the carriageway, join the pieces that meet, drop the short ones. */
export function tramLines(osm: OsmWorld, index: RouteIndex, clear: number): TramLine[] {
  const pieces: number[][] = [];
  for (const t of osm.trams) {
    let cur: number[] = [];
    for (let i = 0; i < t.length; i += 2) {
      const near = index.nearest(t[i], t[i + 1], 140);
      if (near.index < 0) {
        if (cur.length >= 4) pieces.push(cur);
        cur = [];
        continue;
      }
      if (near.dist < clear) {
        if (cur.length >= 4) pieces.push(cur);
        cur = [];
        continue;
      }
      cur.push(t[i], t[i + 1]);
    }
    if (cur.length >= 4) pieces.push(cur);
  }
  // chain pieces end to start (the tracks are one-way, mapped in their direction of travel)
  const same = (a: number[], ai: number, b: number[], bi: number) => Math.hypot(a[ai] - b[bi], a[ai + 1] - b[bi + 1]) < 0.6;
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < pieces.length && !merged; i++) {
      for (let j = 0; j < pieces.length && !merged; j++) {
        if (i === j) continue;
        const a = pieces[i], b = pieces[j];
        if (same(a, a.length - 2, b, 0)) {
          pieces[i] = a.concat(b.slice(2));
          pieces.splice(j, 1);
          merged = true;
        }
      }
    }
  }
  const out: TramLine[] = [];
  for (const p of pieces) {
    const n = p.length / 2;
    const cum = new Float32Array(n);
    for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(p[i * 2] - p[i * 2 - 2], p[i * 2 + 1] - p[i * 2 - 1]);
    if (cum[n - 1] < 30) continue;
    out.push({ pts: Float32Array.from(p), cum, len: cum[n - 1] });
  }
  return out;
}

/** Point and heading (x, z, direction of travel) at distance s along a line. */
export function tramAt(l: TramLine, s: number, out: { x: number; z: number; dx: number; dz: number }) {
  const n = l.cum.length;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (l.cum[m] <= s) lo = m;
    else hi = m;
  }
  const span = l.cum[hi] - l.cum[lo] || 1;
  const t = Math.min(1, Math.max(0, (s - l.cum[lo]) / span));
  const ax = l.pts[lo * 2], az = l.pts[lo * 2 + 1], bx = l.pts[hi * 2], bz = l.pts[hi * 2 + 1];
  out.x = ax + (bx - ax) * t;
  out.z = az + (bz - az) * t;
  out.dx = (bx - ax) / span;
  out.dz = (bz - az) / span;
}

/** Granite-sett bed and two steel rails along every line, in one mesh. */
export function tramTrack(lines: TramLine[], groundAt: (x: number, z: number) => number): THREE.Object3D {
  const pos: number[] = [], col: number[] = [];
  const bed = new THREE.Color().setRGB(0.3, 0.3, 0.3, THREE.SRGBColorSpace);
  const steel = new THREE.Color().setRGB(0.5, 0.5, 0.52, THREE.SRGBColorSpace);
  const quad = (a: number[], b: number[], c: number[], d: number[], k: THREE.Color) => {
    for (const p of [a, b, c, a, c, d]) {
      pos.push(p[0], p[1], p[2]);
      col.push(k.r, k.g, k.b);
    }
  };
  for (const l of lines) {
    const step = 3;
    const n = Math.max(2, Math.ceil(l.len / step) + 1);
    let prev: { x: number; z: number; dx: number; dz: number; y: number } | null = null;
    const cur = { x: 0, z: 0, dx: 0, dz: 1 };
    for (let i = 0; i < n; i++) {
      tramAt(l, Math.min(l.len - 0.01, (i * l.len) / (n - 1)), cur);
      const y = groundAt(cur.x, cur.z);
      if (!Number.isFinite(y)) { prev = null; continue; }
      const here = { ...cur, y };
      if (prev) {
        // right-hand normal of the direction of travel
        const px = prev.dz, pz = -prev.dx, qx = here.dz, qz = -here.dx;
        const P = (p: typeof here, nx: number, nz: number, o: number, h: number) => [p.x + nx * o, p.y + h, p.z + nz * o];
        const side = (o0: number, o1: number, h: number, k: THREE.Color) =>
          quad(P(prev!, px, pz, o0, h), P(here, qx, qz, o0, h), P(here, qx, qz, o1, h), P(prev!, px, pz, o1, h), k);
        side(1.1, -1.1, 0.04, bed);
        // gauge 1,435 mm: rails 72 mm wide, 60 mm above the bed
        side(0.72 - 0.04, 0.72 + 0.04, 0.1, steel);
        side(-0.72 - 0.04, -0.72 + 0.04, 0.1, steel);
      }
      prev = here;
    }
  }
  const g = new THREE.Group();
  if (!pos.length) return g;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.2, side: THREE.DoubleSide }), { key: 'tramtrack', depthBias: 0.01 }));
  mesh.receiveShadow = true;
  g.add(mesh);
  return g;
}

/**
 * A three-section low-floor tram, 27 m long, forward along -Z (as every model here): red body with a white
 * roof edge, a dark window band with white pillars, black skirts and articulation bellows, pantograph, a lit
 * destination box over the cab windscreen.
 */
export function tramGeometry(): THREE.BufferGeometry {
  const srgb = (r: number, g: number, b: number) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
  const red = srgb(0.74, 0.1, 0.1), white = srgb(0.93, 0.93, 0.91), glass = srgb(0.07, 0.09, 0.11);
  const dark = srgb(0.12, 0.12, 0.13), grey = srgb(0.55, 0.57, 0.58), amber = srgb(0.95, 0.62, 0.15);
  const W = 2.4;
  const parts: [THREE.BufferGeometry, THREE.Color][] = [];
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, c: THREE.Color) =>
    parts.push([new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z), c]);
  const sections = [{ z0: -13.5, z1: -4.8 }, { z0: -4.2, z1: 4.2 }, { z0: 4.8, z1: 13.5 }];
  sections.forEach((s, si) => {
    const len = s.z1 - s.z0, zc = (s.z0 + s.z1) / 2;
    box(W, 0.55, len, 0, 0.35, zc, dark);
    box(W, 0.6, len, 0, 0.9, zc, red);
    // window band: glass with white pillars every 1.5 m
    box(W + 0.02, 1.1, len - 0.1, 0, 1.5, zc, glass);
    for (let z = s.z0 + 0.4; z < s.z1 - 0.2; z += 1.5) box(W + 0.05, 1.1, 0.1, 0, 1.5, z, red);
    box(W, 0.75, len, 0, 2.6, zc, red);
    box(W * 0.92, 0.18, len, 0, 3.35, zc, white);
    box(W * 0.6, 0.3, Math.min(len - 1.5, 3.4), 0, 3.53, zc, grey);
    // the cab ends: a raked screen and the destination box
    if (si === 0) {
      box(W - 0.1, 1.1, 0.06, 0, 1.5, s.z0 - 0.02, glass);
      box(W * 0.62, 0.3, 0.08, 0, 2.7, s.z0 - 0.03, amber);
    }
    if (si === 2) box(W - 0.1, 1.1, 0.06, 0, 1.5, s.z1 + 0.02, glass);
  });
  // bellows between the sections
  box(W * 0.9, 2.6, 0.7, 0, 0.7, -4.5, dark);
  box(W * 0.9, 2.6, 0.7, 0, 0.7, 4.5, dark);
  // pantograph on the middle section
  box(0.1, 0.6, 0.1, 0.35, 3.6, 1.0, dark);
  box(0.1, 0.6, 0.1, -0.35, 3.6, 1.0, dark);
  box(1.5, 0.06, 0.1, 0, 4.2, 1.0, dark);
  return mergeColored(parts);
}

export const tramMaterial = () =>
  patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.3 }), { key: 'tram' });
