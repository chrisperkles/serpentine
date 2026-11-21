// Vienna Ringstrasse historicism: the geometry of one block or one 3D part of it. Cream, ochre and "Schönbrunn
// yellow" plaster blocks of five or six storeys under a stone cornice, slate and clay hip and mansard roofs,
// domes, onion caps and spires where OSM's building parts say so, and grey or sandstone monuments (Rathaus,
// Opera, Parliament, museums). Windows, rustication, pediments and dormers are drawn by the facade shader
// (Buildings.ts, surfaces 11-13) from the vertex data this file writes.

import * as THREE from 'three';
import type { Building } from '../geo/osm.ts';
import { cornice, parseColour, pointInRing, rnd, simplify, type Builder } from './Buildings.ts';

/** Surface ids of the facade shader: plaster block, monument stone, slate / clay / copper roof. */
export const VIENNA = 11, VMONUMENT = 12, VROOF = 13;
const TRIM = 3, CURTAIN = 10;
const V3 = (p: THREE.Vector2, y: number) => new THREE.Vector3(p.x, y, p.y);

const srgb = (r: number, g: number, b: number) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);

// plaster of the Gründerzeit blocks: cream and pale ochre are most of the Ring, "Schönbrunn yellow" and warm
// grey-beige the rest; a few pink-sand and olive-cream houses break the rows
export const VIENNA_WALLS = [
  srgb(0.88, 0.83, 0.7), srgb(0.88, 0.83, 0.7), srgb(0.86, 0.79, 0.6), srgb(0.84, 0.72, 0.48), srgb(0.92, 0.77, 0.36),
  srgb(0.76, 0.72, 0.64), srgb(0.8, 0.78, 0.73), srgb(0.86, 0.73, 0.58), srgb(0.81, 0.79, 0.64), srgb(0.86, 0.85, 0.81),
  srgb(0.86, 0.79, 0.6), srgb(0.74, 0.66, 0.56),
];
// slate, a few clay-brown roofs, and verdigris for the odd copper one
export const VIENNA_ROOFS = [
  srgb(0.27, 0.29, 0.32), srgb(0.27, 0.29, 0.32), srgb(0.34, 0.35, 0.37), srgb(0.3, 0.31, 0.33), srgb(0.45, 0.25, 0.19),
  srgb(0.36, 0.22, 0.18), srgb(0.24, 0.25, 0.28),
];
const VERDIGRIS = srgb(0.3, 0.43, 0.38);
const GLASS = [srgb(0.3, 0.4, 0.47), srgb(0.2, 0.26, 0.31), srgb(0.46, 0.54, 0.57), srgb(0.15, 0.18, 0.21)];
const BRICK = srgb(0.5, 0.3, 0.24);
const DECK = srgb(0.36, 0.36, 0.37);

// public buildings drawn as monuments: wide bays, pilasters, a balustrade, stone colour from the name
const MONUMENT = /oper|parlament|rathaus|burgtheater|universit|museum|votiv|hofburg|kirche|börse|boerse|akademie|justiz|volkstheater|konzerthaus|musikverein|ministerium|theater|schauspiel|kursalon|albertina|dom\b|gericht|sezession|secession|neue burg|stallburg|amalienburg|redoute|burgring|stadttempel|synagoge/i;

/** What the big names are made of: stone colour (sRGB) from what is known of the buildings, not from the tag. */
function monumentColour(name: string, seed: number): THREE.Color {
  const n = name.toLowerCase();
  if (/rathaus/.test(n)) return srgb(0.7, 0.69, 0.64);
  if (/votiv/.test(n)) return srgb(0.76, 0.76, 0.72);
  if (/parlament/.test(n)) return srgb(0.88, 0.85, 0.76);
  if (/oper/.test(n)) return srgb(0.82, 0.79, 0.7);
  if (/museum/.test(n)) return srgb(0.8, 0.74, 0.6);
  if (/universit/.test(n)) return srgb(0.88, 0.8, 0.62);
  if (/burgtheater/.test(n)) return srgb(0.86, 0.79, 0.64);
  return srgb(0.82 + rnd(seed) * 0.06, 0.77 + rnd(seed + 1) * 0.05, 0.66);
}

type RoofKind = 'flat' | 'hip' | 'gable' | 'mansard' | 'dome' | 'onion' | 'spire';

function roofKindOf(tag: string | undefined): RoofKind | null {
  switch (tag) {
    case 'dome': return 'dome';
    case 'onion': return 'onion';
    case 'pyramidal': case 'cone': return 'spire';
    case 'mansard': case 'gambrel': return 'mansard';
    case 'hipped': case 'half-hipped': case 'saltbox': case 'double_saltbox': case 'quadruple_saltbox': case 'many': return 'hip';
    case 'gabled': return 'gable';
    // round barrels, skillions and flat decks stay flat: no good outline-only version
    case 'flat': case 'round': case 'skillion': return 'flat';
    default: return null;
  }
}

export function edgeNormals(ring: THREE.Vector2[], sgn: number): THREE.Vector2[] {
  const n = ring.length;
  const out: THREE.Vector2[] = [];
  let last = new THREE.Vector2(0, 1);
  for (let i = 0; i < n; i++) {
    const e = new THREE.Vector2().subVectors(ring[(i + 1) % n], ring[i]);
    // a doubled node leaves a zero-length edge: keep the previous direction instead of NaN
    if (e.length() > 1e-4) last = new THREE.Vector2(-e.y * sgn, e.x * sgn).normalize();
    out.push(last.clone());
  }
  return out;
}

/** The footprint pushed inward by d with mitred corners; null where it folds over or vanishes. */
export function insetRing(ring: THREE.Vector2[], sgn: number, d: number): THREE.Vector2[] | null {
  const n = ring.length;
  const nor = edgeNormals(ring, sgn);
  const inner = ring.map((p, i) => {
    const n0 = nor[(i - 1 + n) % n], n1 = nor[i];
    const m = new THREE.Vector2().addVectors(n0, n1).multiplyScalar(d / Math.max(1 + n0.dot(n1), 0.22));
    return p.clone().add(m);
  });
  let a = 0, ia = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += ring[i].x * ring[j].y - ring[j].x * ring[i].y;
    ia += inner[i].x * inner[j].y - inner[j].x * inner[i].y;
  }
  if (Math.sign(ia) !== Math.sign(a) || Math.abs(ia) < Math.abs(a) * 0.06) return null;
  // a mitre that shoots out of a concave corner left a dark plate hanging beside the roof: every inset point must
  // lie inside the footprint and every inset edge must still run the way its wall does
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (!pointInRing(ring, inner[i].x, inner[i].y)) return null;
    const eo = new THREE.Vector2().subVectors(ring[j], ring[i]), ei = new THREE.Vector2().subVectors(inner[j], inner[i]);
    if (eo.length() > 1e-3 && ei.dot(eo) <= 0) return null;
  }
  return inner;
}

/** Successive insets from y0 up (each stage [horizontal run, rise]) with a flat cap on the last; null if the first folds. */
function roofStages(
  b: Builder, ring: THREE.Vector2[], sgn: number, y0: number, stages: [number, number][], col: THREE.Color, centre: THREE.Vector3,
): { ring: THREE.Vector2[]; y: number } | null {
  let cur = ring, y = y0;
  for (const [d, dy] of stages) {
    const nxt = insetRing(cur, sgn, d);
    if (!nxt) break;
    for (let i = 0; i < cur.length; i++) {
      const j = (i + 1) % cur.length;
      b.quad(
        new THREE.Vector3(cur[i].x, y, cur[i].y), new THREE.Vector3(cur[j].x, y, cur[j].y),
        new THREE.Vector3(nxt[j].x, y + dy, nxt[j].y), new THREE.Vector3(nxt[i].x, y + dy, nxt[i].y), col, VROOF, centre,
      );
    }
    cur = nxt;
    y += dy;
  }
  if (cur === ring) return null;
  // the top of a big block is a flat deck of sheet metal and gravel, not tiles: in the roof's colour it lay
  // over a whole city block as one mint-green slab
  for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(cur.map((p) => p.clone()), [])) {
    b.tri(new THREE.Vector3(cur[i].x, y, cur[i].y), new THREE.Vector3(cur[j].x, y, cur[j].y), new THREE.Vector3(cur[k].x, y, cur[k].y), DECK, TRIM, centre);
  }
  return { ring: cur, y };
}

/** Gable or hip over the footprint's oriented rectangle; false when the footprint is not rectangular enough. */
function ridgeRoof(
  b: Builder, local: THREE.Vector2[], wallTop: number, rise: number, hip: boolean, roofCol: THREE.Color, wall: THREE.Color,
  wallSurf: number, centre: THREE.Vector3,
): boolean {
  let best = 0;
  let dir = new THREE.Vector2(1, 0);
  for (let i = 0; i < local.length; i++) {
    const e = new THREE.Vector2().subVectors(local[(i + 1) % local.length], local[i]);
    if (e.length() > best) {
      best = e.length();
      dir = e.clone().normalize();
    }
  }
  const perp = new THREE.Vector2(-dir.y, dir.x);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const p of local) {
    const u = p.x * dir.x + p.y * dir.y, v = p.x * perp.x + p.y * perp.y;
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
  }
  let area = 0;
  for (let i = 0; i < local.length; i++) {
    const p = local[i], q = local[(i + 1) % local.length];
    area += p.x * q.y - q.x * p.y;
  }
  if (Math.abs(area) / 2 / ((u1 - u0) * (v1 - v0)) < 0.82 || u1 - u0 < 2 * 1.2 || v1 - v0 < 1.5) return false;
  const P = (u: number, v: number, y: number) => new THREE.Vector3(dir.x * u + perp.x * v, y, dir.y * u + perp.y * v);
  const vm = (v0 + v1) / 2, half = (v1 - v0) / 2;
  const ov = 0.35, ey = wallTop - 0.15, ry = wallTop + rise;
  const hipRun = hip ? Math.min(half, (u1 - u0) / 2 - 0.2) : 0;
  const rA = P(u0 + hipRun, vm, ry), rB = P(u1 - hipRun, vm, ry);
  const e00 = P(u0 - ov, v0 - ov, ey), e10 = P(u1 + ov, v0 - ov, ey), e01 = P(u0 - ov, v1 + ov, ey), e11 = P(u1 + ov, v1 + ov, ey);
  const rc = new THREE.Vector3(centre.x, wallTop - 50, centre.z);
  b.quad(e00, e10, rB, rA, roofCol, VROOF, rc);
  b.quad(e01, e11, rB, rA, roofCol, VROOF, rc);
  if (hip) {
    b.tri(e00, e01, rA, roofCol, VROOF, rc);
    b.tri(e10, e11, rB, roofCol, VROOF, rc);
  } else {
    // the gable ends are plastered wall to the ridge
    const inside = new THREE.Vector3(centre.x, wallTop - 4, centre.z);
    for (const u of [u0, u1]) b.tri(P(u, v0, wallTop), P(u, v1, wallTop), P(u, vm, ry), wall, wallSurf, inside);
  }
  return true;
}

/** A cap over the footprint made of rings scaled about the centroid: a dome or an onion. */
function capRoof(
  b: Builder, local: THREE.Vector2[], cx: number, cz: number, y0: number, h: number, profile: [number, number][], col: THREE.Color, surf = VROOF,
) {
  const rc = new THREE.Vector3(cx, y0 - 50, cz);
  const ringAt = (s: number, y: number) => local.map((p) => new THREE.Vector3(cx + (p.x - cx) * s, y, cz + (p.y - cz) * s));
  let prev = ringAt(profile[0][0], y0 + profile[0][1] * h);
  for (let k = 1; k < profile.length; k++) {
    const [s, f] = profile[k];
    const cur = ringAt(s, y0 + f * h);
    for (let i = 0; i < prev.length; i++) {
      const j = (i + 1) % prev.length;
      if (s < 0.01) b.tri(prev[i], prev[j], cur[i], col, surf, rc);
      else b.quad(prev[i], prev[j], cur[j], cur[i], col, surf, rc);
    }
    prev = cur;
  }
}

// ---- shared relief geometry (Vienna blocks and Manhattan apartment houses) ----
// What reads from the saddle and from a drone at 50 to 400 m is silhouette and relief that catches light: a ledge
// that throws a shadow, a pier standing proud of the wall, a dormer against the slope. Fine window patterns do not.

/** Outward unit normal of every edge (sgn: winding of the footprint). */
export function outNormals(ring: THREE.Vector2[], sgn: number): THREE.Vector2[] {
  return edgeNormals(ring, sgn).map((n) => n.multiplyScalar(-1));
}

/** The footprint pushed outward by d with mitred corners. */
export function mitreRing(ring: THREE.Vector2[], nor: THREE.Vector2[], d: number): THREE.Vector2[] {
  const n = ring.length;
  return ring.map((p, i) => {
    const n0 = nor[(i - 1 + n) % n], n1 = nor[i];
    return p.clone().add(new THREE.Vector2().addVectors(n0, n1).multiplyScalar(d / Math.max(1 + n0.dot(n1), 0.35)));
  });
}

/** A horizontal moulding all round the footprint: a band h tall standing `out` proud of the wall, lit on top, dark below. */
export function ledge(
  b: Builder, ring: THREE.Vector2[], sgn: number, y: number, h: number, out: number, col: THREE.Color, shade: THREE.Color, minEdge = 2.5, noSoffit = false,
) {
  const n = ring.length;
  const nor = outNormals(ring, sgn);
  const big = mitreRing(ring, nor, out);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (ring[i].distanceTo(ring[j]) < minEdge) continue;
    const o = nor[i];
    const mid = (yy: number) => new THREE.Vector3((big[i].x + big[j].x) / 2, yy, (big[i].y + big[j].y) / 2);
    const inside = mid(y + h / 2).addScaledVector(new THREE.Vector3(o.x, 0, o.y), -30);
    b.quad(V3(ring[i], y + h), V3(ring[j], y + h), V3(big[j], y + h), V3(big[i], y + h), col, TRIM, mid(y + h - 30));
    b.quad(V3(big[i], y), V3(big[j], y), V3(big[j], y + h), V3(big[i], y + h), col, TRIM, inside);
    if (!noSoffit) b.quad(V3(ring[i], y), V3(ring[j], y), V3(big[j], y), V3(big[i], y), shade, TRIM, mid(y + 30));
  }
}

/**
 * Corner piers (quoins, or the corner bays of a Ringstrasse block): at every convex corner where both walls are long
 * enough, a strip `width` wide on each wall standing `depth` proud, from y0 to y1.
 */
export function quoins(
  b: Builder, ring: THREE.Vector2[], sgn: number, y0: number, y1: number, depth: number, width: number, col: THREE.Color, surf: number, minEdge: number,
) {
  const n = ring.length;
  const nor = outNormals(ring, sgn);
  for (let i = 0; i < n; i++) {
    const prev = (i - 1 + n) % n;
    const e0 = new THREE.Vector2().subVectors(ring[i], ring[prev]);
    const e1 = new THREE.Vector2().subVectors(ring[(i + 1) % n], ring[i]);
    const l0 = e0.length(), l1 = e1.length();
    if (l0 < minEdge || l1 < minEdge) continue;
    e0.divideScalar(l0);
    e1.divideScalar(l1);
    if ((e0.x * e1.y - e0.y * e1.x) * sgn < 0.5) continue; // convex corners of about 90° or sharper only
    const n0 = nor[prev], n1 = nor[i];
    const A = ring[i].clone().addScaledVector(e0, -width), C = ring[i], B = ring[i].clone().addScaledVector(e1, width);
    const Ao = A.clone().addScaledVector(n0, depth), Bo = B.clone().addScaledVector(n1, depth);
    const Co = C.clone().add(new THREE.Vector2().addVectors(n0, n1).multiplyScalar(depth / Math.max(1 + n0.dot(n1), 0.35)));
    const c = (p: THREE.Vector2, q: THREE.Vector2, nn: THREE.Vector2) =>
      new THREE.Vector3((p.x + q.x) / 2 - nn.x * 20, (y0 + y1) / 2, (p.y + q.y) / 2 - nn.y * 20);
    b.quad(V3(Ao, y0), V3(Co, y0), V3(Co, y1), V3(Ao, y1), col, surf, c(Ao, Co, n0));
    b.quad(V3(Co, y0), V3(Bo, y0), V3(Bo, y1), V3(Co, y1), col, surf, c(Co, Bo, n1));
    // the two faces that turn back into the wall
    b.quad(V3(A, y0), V3(Ao, y0), V3(Ao, y1), V3(A, y1), col, surf, new THREE.Vector3(A.x + e0.x * 5, (y0 + y1) / 2, A.y + e0.y * 5));
    b.quad(V3(Bo, y0), V3(B, y0), V3(B, y1), V3(Bo, y1), col, surf, new THREE.Vector3(B.x - e1.x * 5, (y0 + y1) / 2, B.y - e1.y * 5));
  }
}

/** A shallow bay or risalit: part of one wall (t0..t1 along edge i, metres) standing `depth` proud from y0 to y1. */
export function projection(
  b: Builder, ring: THREE.Vector2[], sgn: number, i: number, t0: number, t1: number, depth: number, y0: number, y1: number,
  col: THREE.Color, surf: number,
) {
  const p = ring[i], q = ring[(i + 1) % ring.length];
  const e = new THREE.Vector2().subVectors(q, p);
  const len = e.length();
  if (len < t1 + 0.1) return;
  e.divideScalar(len);
  const o = outNormals(ring, sgn)[i];
  const A = p.clone().addScaledVector(e, t0), B = p.clone().addScaledVector(e, t1);
  const Ao = A.clone().addScaledVector(o, depth), Bo = B.clone().addScaledVector(o, depth);
  const mid = (y: number) => new THREE.Vector3((A.x + B.x) / 2, y, (A.y + B.y) / 2);
  const ym = (y0 + y1) / 2;
  b.quad(V3(Ao, y0), V3(Bo, y0), V3(Bo, y1), V3(Ao, y1), col, surf, mid(ym).addScaledVector(new THREE.Vector3(o.x, 0, o.y), -20));
  b.quad(V3(A, y0), V3(Ao, y0), V3(Ao, y1), V3(A, y1), col, surf, mid(ym).addScaledVector(new THREE.Vector3(e.x, 0, e.y), 5));
  b.quad(V3(Bo, y0), V3(B, y0), V3(B, y1), V3(Bo, y1), col, surf, mid(ym).addScaledVector(new THREE.Vector3(e.x, 0, e.y), -5));
}

/** A five-sided post (no underside): balustrade piers, chimney stacks. */
export function post(b: Builder, cx: number, cz: number, dir: THREE.Vector2, hu: number, hv: number, y0: number, y1: number, col: THREE.Color, surf = TRIM) {
  const perp = new THREE.Vector2(-dir.y, dir.x);
  const P = (u: number, v: number, y: number) => new THREE.Vector3(cx + dir.x * u + perp.x * v, y, cz + dir.y * u + perp.y * v);
  const c = new THREE.Vector3(cx, (y0 + y1) / 2, cz);
  const k = [[-hu, -hv], [hu, -hv], [hu, hv], [-hu, hv]];
  for (let i = 0; i < 4; i++) {
    const [u0, v0] = k[i], [u1, v1] = k[(i + 1) % 4];
    b.quad(P(u0, v0, y0), P(u1, v1, y0), P(u1, v1, y1), P(u0, v0, y1), col, surf, c);
  }
  b.quad(P(-hu, -hv, y1), P(hu, -hv, y1), P(hu, hv, y1), P(-hu, hv, y1), col, surf, c);
}

const STONE_LIGHT = srgb(0.86, 0.84, 0.78);
const BRONZE = srgb(0.2, 0.3, 0.26);

/**
 * A stone balustrade round the eaves of a monument: a solid parapet, a pier every few metres and, on some piers, a
 * statue (a plinth, a body and a head: a dark figure against the sky is all a 200 m view can take).
 */
export function balustrade(b: Builder, ring: THREE.Vector2[], sgn: number, y: number, seed: number, statues: boolean, stone = STONE_LIGHT) {
  const n = ring.length;
  const nor = outNormals(ring, sgn);
  let count = 0;
  for (let i = 0; i < n; i++) {
    const p = ring[i], q = ring[(i + 1) % n];
    const e = new THREE.Vector2().subVectors(q, p);
    const len = e.length();
    if (len < 4) continue;
    e.divideScalar(len);
    const o = nor[i];
    const h = 1.0;
    const mid = new THREE.Vector3((p.x + q.x) / 2, y + h / 2, (p.y + q.y) / 2);
    const inside = mid.clone().addScaledVector(new THREE.Vector3(o.x, 0, o.y), -20);
    b.quad(V3(p, y), V3(q, y), V3(q, y + h), V3(p, y + h), stone, TRIM, inside);
    const pi = p.clone().addScaledVector(o, -0.35), qi = q.clone().addScaledVector(o, -0.35);
    b.quad(V3(p, y + h), V3(q, y + h), V3(qi, y + h), V3(pi, y + h), stone, TRIM, mid.clone().setY(y - 20));
    const step = statues ? 7 : 5;
    const m = Math.max(1, Math.round(len / step));
    for (let k = 0; k <= m; k++) {
      const t = (k / m) * (len - 0.8) + 0.4;
      const x = p.x + e.x * t - o.x * 0.2, z = p.y + e.y * t - o.y * 0.2;
      post(b, x, z, e, 0.3, 0.3, y, y + h + 0.5, stone);
      if (statues && k % 2 === 0 && count < 26 && rnd(seed + i * 11 + k) > 0.25) {
        count++;
        const hgt = 1.5 + rnd(seed + k * 3 + i) * 0.7;
        post(b, x, z, e, 0.45, 0.45, y + h + 0.5, y + h + 1.2, stone);
        post(b, x, z, e, 0.34, 0.2, y + h + 1.2, y + h + 1.2 + hgt * 0.62, BRONZE);
        post(b, x, z, e, 0.2, 0.2, y + h + 1.2 + hgt * 0.62, y + h + 1.2 + hgt, BRONZE);
      }
    }
  }
}

const DORMER_GLASS = srgb(0.05, 0.06, 0.08);
const DORMER_FRAME = srgb(0.8, 0.77, 0.7);

/**
 * Real dormers on one roof stage (the slope from ring `cur` at y0 rising dy over the inset d): a small window under
 * a gable, set into the slope. In silhouette they break the eaves line and catch the sun, which a shader pattern cannot.
 */
export function dormers(
  b: Builder, cur: THREE.Vector2[], sgn: number, y0: number, dy: number, d: number, spacing: number, roofCol: THREE.Color,
  seed: number, maxCount: number, hwMax = 0.62,
) {
  // a dormer's roof runs back level until it meets the slope: on a shallow roof (the University's, 1 m of rise
  // over 15 m) that is a white slab metres long sticking out over the eaves. Dormers belong on steep slopes only.
  if (dy / d < 0.6) return 0;
  const n = cur.length;
  const nin = edgeNormals(cur, sgn);
  let count = 0;
  for (let i = 0; i < n && count < maxCount; i++) {
    const p = cur[i], q = cur[(i + 1) % n];
    const e = new THREE.Vector2().subVectors(q, p);
    const len = e.length();
    if (len < 7) continue;
    e.divideScalar(len);
    const ni = nin[i];
    const room = len - 5;
    const m = Math.max(1, Math.floor(room / spacing));
    const gap = room / m;
    for (let k = 0; k < m && count < maxCount; k++) {
      const t = 2.5 + gap * (k + 0.5);
      if (rnd(seed + i * 31 + k * 7) < 0.12) continue; // a gap now and then so the row is not a fence
      const hw = hwMax * (0.9 + 0.2 * rnd(seed + k));
      const sf = d * 0.34;
      const yb = y0 + dy * (sf / d);
      const gab = hw * 0.75;
      const hF = Math.min(1.5, dy * 0.9 - dy * (sf / d) - gab);
      if (hF < 0.75) continue;
      const yt = yb + hF, ya = yt + gab;
      const st = d * (yt - y0) / dy, sa = Math.min(d * (ya - y0) / dy, d * 0.98);
      const C = p.clone().addScaledVector(e, t);
      const P = (s: number, a: number, y: number) => new THREE.Vector3(C.x + ni.x * s + e.x * a, y, C.y + ni.y * s + e.y * a);
      const behind = P(sf + 3, 0, yb + 0.6);
      b.quad(P(sf, -hw, yb), P(sf, hw, yb), P(sf, hw, yt), P(sf, -hw, yt), DORMER_FRAME, TRIM, behind);
      b.quad(P(sf - 0.04, -hw * 0.62, yb + 0.22), P(sf - 0.04, hw * 0.62, yb + 0.22), P(sf - 0.04, hw * 0.62, yt - 0.2), P(sf - 0.04, -hw * 0.62, yt - 0.2), DORMER_GLASS, TRIM, behind);
      b.tri(P(sf, -hw, yt), P(sf, hw, yt), P(sf, 0, ya), DORMER_FRAME, TRIM, behind);
      const inner = P((sf + st) / 2, 0, yb + 0.6);
      b.tri(P(sf, -hw, yb), P(sf, -hw, yt), P(st, -hw, yt), DORMER_FRAME, TRIM, inner.clone().add(new THREE.Vector3(e.x, 0, e.y)));
      b.tri(P(sf, hw, yb), P(sf, hw, yt), P(st, hw, yt), DORMER_FRAME, TRIM, inner.clone().sub(new THREE.Vector3(e.x, 0, e.y)));
      const below = P((sf + st) / 2, 0, yb - 2);
      b.quad(P(sf, -hw, yt), P(sf, 0, ya), P(sa, 0, ya), P(st, -hw, yt), roofCol, TRIM, below);
      b.quad(P(sf, hw, yt), P(sf, 0, ya), P(sa, 0, ya), P(st, hw, yt), roofCol, TRIM, below);
      count++;
    }
  }
  return count;
}

const SKY_GLASS = srgb(0.16, 0.2, 0.24);

/** Skylight lanterns and a ridge crest on a big flat deck, so a museum or university roof is not one bare plane. */
export function deckDetail(b: Builder, ring: THREE.Vector2[], y: number, area: number, seed: number, crest: THREE.Color) {
  if (area < 650) return;
  let best = 0;
  let dir = new THREE.Vector2(1, 0);
  for (let i = 0; i < ring.length; i++) {
    const e = new THREE.Vector2().subVectors(ring[(i + 1) % ring.length], ring[i]);
    if (e.length() > best) { best = e.length(); dir = e.clone().normalize(); }
  }
  const perp = new THREE.Vector2(-dir.y, dir.x);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const p of ring) {
    const u = p.x * dir.x + p.y * dir.y, v = p.x * perp.x + p.y * perp.y;
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
  }
  const at = (u: number, v: number) => new THREE.Vector2(dir.x * u + perp.x * v, dir.y * u + perp.y * v);
  const inside = (u: number, v: number, hu: number, hv: number) =>
    [[0, 0], [hu, hv], [-hu, hv], [hu, -hv], [-hu, -hv]].every(([a, c]) => { const q = at(u + a, v + c); return pointInRing(ring, q.x, q.y); });
  const vm = (v0 + v1) / 2;
  // a crest along the long axis (a lead ridge) when the deck is wide enough to hold one
  if (v1 - v0 > 9 && u1 - u0 > 16) {
    const m = at((u0 + u1) / 2, vm);
    if (inside((u0 + u1) / 2, vm, (u1 - u0) / 2 - 3, 0.5)) post(b, m.x, m.y, dir, (u1 - u0) / 2 - 3, 0.35, y, y + 0.9, crest);
  }
  // lanterns in a grid either side of the crest
  let n = 0;
  const su = 11, sv = Math.min(11, (v1 - v0) / 2.4);
  const rows = [vm - sv, vm + sv];
  if (v1 - v0 > 50) rows.push(vm - 2 * sv, vm + 2 * sv);
  for (let u = u0 + 6; u < u1 - 5 && n < (v1 - v0 > 50 ? 44 : 10); u += su) {
    for (const vv of rows) {
      if (!inside(u, vv, 3, 1.6)) continue;
      if (rnd(seed + u * 0.37 + vv) < 0.2) continue;
      const c = at(u, vv);
      post(b, c.x, c.y, dir, 2.4, 1.1, y, y + 0.45, crest);
      const R = (uu: number, v: number, yy: number) => { const q = at(u + uu, vv + v); return new THREE.Vector3(q.x, yy, q.y); };
      const low = new THREE.Vector3(c.x, y - 5, c.y);
      b.quad(R(-2.1, -0.9, y + 0.45), R(2.1, -0.9, y + 0.45), R(2.1, 0, y + 1.5), R(-2.1, 0, y + 1.5), SKY_GLASS, TRIM, low);
      b.quad(R(-2.1, 0.9, y + 0.45), R(2.1, 0.9, y + 0.45), R(2.1, 0, y + 1.5), R(-2.1, 0, y + 1.5), SKY_GLASS, TRIM, low);
      b.tri(R(-2.1, -0.9, y + 0.45), R(-2.1, 0.9, y + 0.45), R(-2.1, 0, y + 1.5), crest, TRIM, low);
      b.tri(R(2.1, -0.9, y + 0.45), R(2.1, 0.9, y + 0.45), R(2.1, 0, y + 1.5), crest, TRIM, low);
      n++;
    }
  }
}

const TURRET_CAP: [number, number][] = [[1.1, -0.03], [1, 0], [0.96, 0.2], [0.82, 0.42], [0.55, 0.64], [0.26, 0.8], [0.09, 0.88], [0.07, 0.9], [0, 1]];
const SPIRE: [number, number][] = [[1.1, -0.02], [1, 0], [0.7, 0.26], [0.42, 0.55], [0.2, 0.8], [0.07, 0.94], [0, 1]];

/**
 * A corner turret (Erker) with a small dome: an eight-sided shaft that starts a few floors below the eaves on a
 * corbel cone and stands out past the corner, with a copper or slate cap and a finial.
 */
function turret(
  b: Builder, ring: THREE.Vector2[], sgn: number, i: number, wallTop: number, wall: THREE.Color, cap: THREE.Color, seed: number,
) {
  const n = ring.length;
  const nor = outNormals(ring, sgn);
  const m = new THREE.Vector2().addVectors(nor[(i - 1 + n) % n], nor[i]).normalize();
  const r = 2.1 + rnd(seed + 41) * 0.5;
  const T = ring[i].clone().addScaledVector(m, 0.35);
  const N = 8;
  const pts = Array.from({ length: N }, (_, k) => new THREE.Vector2(T.x + Math.cos((k / N) * Math.PI * 2 + 0.39) * r, T.y + Math.sin((k / N) * Math.PI * 2 + 0.39) * r));
  const yb = wallTop - 8.5, yt = wallTop + 3.6;
  b.setBase(yb, yt);
  b.setAux(-1);
  const c = new THREE.Vector3(T.x, (yb + yt) / 2, T.y);
  for (let k = 0; k < N; k++) {
    const a = pts[k], q = pts[(k + 1) % N];
    b.quad(V3(a, yb), V3(q, yb), V3(q, yt), V3(a, yt), wall, VIENNA, c);
  }
  b.setAux(0);
  // corbel cone under the shaft
  const tip = new THREE.Vector3(T.x, yb - 2.4, T.y);
  for (let k = 0; k < N; k++) b.tri(V3(pts[k], yb), V3(pts[(k + 1) % N], yb), tip, wall.clone().multiplyScalar(0.8), TRIM, new THREE.Vector3(T.x, yb + 20, T.y));
  // cornice ring and the cap
  ledge(b, pts, 1, yt - 0.25, 0.5, 0.35, STONE_LIGHT, wall.clone().multiplyScalar(0.6), 0.5);
  capRoof(b, pts, T.x, T.y, yt, 5.2 + rnd(seed + 43) * 1.2, TURRET_CAP, cap, VROOF);
}

const DOME: [number, number][] = [[1, 0], [0.97, 0.26], [0.87, 0.5], [0.69, 0.72], [0.42, 0.89], [0.14, 0.98], [0, 1]];
const ONION: [number, number][] = [[1, 0], [1.2, 0.1], [1.26, 0.2], [1.1, 0.34], [0.8, 0.5], [0.46, 0.66], [0.22, 0.8], [0.09, 0.9], [0, 1]];

/**
 * One Ring block or one 3D part of a monument: straight walls from the ground (or the part's min_height) to the eaves
 * with the stone cornice, then the roof the OSM tags ask for, or the one a Gründerzeit block of that size would have.
 */
export function addViennaBlock(
  bld: Building, b: Builder, heightAt: (x: number, z: number) => number, seed: number, ox: number, oz: number,
) {
  const ring = simplify(bld.ring);
  if (ring.length < 3) return;
  let gmin = Infinity, gmax = -Infinity;
  for (const p of ring) {
    const h = heightAt(p.x, p.y);
    if (!Number.isFinite(h)) return;
    gmin = Math.min(gmin, h);
    gmax = Math.max(gmax, h);
  }
  const local = ring.map((p) => new THREE.Vector2(p.x - ox, p.y - oz));
  let area = 0, cx = 0, cz = 0;
  for (let i = 0; i < local.length; i++) {
    const p = local[i], q = local[(i + 1) % local.length];
    const w = p.x * q.y - q.x * p.y;
    area += w;
    cx += (p.x + q.x) * w;
    cz += (p.y + q.y) * w;
  }
  if (Math.abs(area) < 1) return;
  const sgn = Math.sign(area);
  cx /= 3 * area;
  cz /= 3 * area;
  area = Math.abs(area) / 2;
  const part = !!bld.part;
  const name = bld.name ?? '';
  const mat = bld.material;
  const glass = mat === 'glass' || mat === 'metal' || mat === 'steel';
  const monument = !glass && (MONUMENT.test(name) || (part && (!!bld.wallColour || mat === 'stone')));

  // --- roof shape: the tag, else what a block of this kind carries
  let kind = roofKindOf(bld.roofTag);
  const sizeM = Math.sqrt(area);
  if (kind === null) {
    if (part || glass) kind = 'flat';
    else if (area < 40) kind = 'flat';
    else {
      const r = rnd(seed + 3);
      kind = monument ? 'hip' : r < 0.58 ? 'hip' : r < 0.84 && bld.height > 14 ? 'mansard' : 'flat';
    }
  }
  if (glass) kind = 'flat';

  // --- heights: tagged to the highest point; untagged blocks get Gründerzeit storeys (about 4.2 m) under the eaves
  const rr = bld.roofHeight;
  let wallTop: number, rise = 0;
  const capKind = kind === 'dome' || kind === 'onion' || kind === 'spire';
  if (part || bld.heightTagged) {
    const H = Math.max(bld.height, 3);
    if (capKind) rise = Math.min(rr ?? (kind === 'spire' ? Math.min(sizeM * 2.2, 16) : sizeM * 0.5), H * 0.8);
    else if (kind !== 'flat') rise = Math.min(rr ?? (part ? 3 : Math.min(4.5, H * 0.2)), H * 0.5);
    wallTop = gmax + H - rise;
  } else {
    const lv = bld.levels ?? Math.max(1, Math.round((bld.height - 1) / 3));
    wallTop = gmax + lv * 4.2 + 1.2;
    if (capKind) rise = rr ?? (kind === 'spire' ? Math.min(sizeM * 2.2, 16) : sizeM * 0.5);
    else if (kind !== 'flat') rise = rr ?? 4;
  }
  const bottom = bld.minHeight !== undefined ? gmax + Math.min(bld.minHeight, wallTop - gmax - 1) : gmin - 0.6;
  if (wallTop - bottom < 1) return;

  // --- colours
  const hsl = { h: 0, s: 0, l: 0 };
  let wall: THREE.Color;
  if (glass) {
    wall = parseColour(bld.wallColour, GLASS[Math.floor(rnd(seed) * GLASS.length)]).clone();
    wall.getHSL(hsl, THREE.SRGBColorSpace);
    wall.setHSL(hsl.h, Math.min(hsl.s, 0.5), Math.min(Math.max(hsl.l, 0.08), 0.6), THREE.SRGBColorSpace);
  } else if (bld.wallColour) {
    // tagged colours are often pure black or white or garish: keep the hue, cap saturation, keep it stone-light
    wall = parseColour(bld.wallColour, VIENNA_WALLS[0]).clone();
    wall.getHSL(hsl, THREE.SRGBColorSpace);
    wall.setHSL(hsl.h, Math.min(hsl.s, 0.55), Math.min(Math.max(hsl.l, 0.34), 0.84), THREE.SRGBColorSpace);
  } else if (monument) {
    wall = monumentColour(name, seed);
  } else if (mat === 'brick') {
    wall = BRICK.clone();
  } else {
    wall = VIENNA_WALLS[Math.floor(rnd(seed) * VIENNA_WALLS.length)].clone();
    wall.multiplyScalar(0.96 + rnd(seed + 5) * 0.08);
  }
  // verdigris only on domes and spires: as the default for a monument's main roof it laid a mint slab over the Parliament
  const roofDefault = (monument && capKind) ? VERDIGRIS : VIENNA_ROOFS[Math.floor(rnd(seed + 7) * VIENNA_ROOFS.length)];
  const roofCol = parseColour(bld.roofColour, roofDefault).clone();
  if (bld.roofColour) {
    roofCol.getHSL(hsl, THREE.SRGBColorSpace);
    roofCol.setHSL(hsl.h, Math.min(hsl.s, 0.6), Math.min(Math.max(hsl.l, 0.1), 0.72), THREE.SRGBColorSpace);
    // OSM's copper green (#6EBE9F) is mint; weathered verdigris under noon sun is greyer and darker
    if (hsl.h > 0.33 && hsl.h < 0.55) {
      // The University's whole roof is tagged so. Mixing towards grey in sRGB left green at twice the red
      // in linear light, and under the sun that was still a mint slab: set the weathered tone outright.
      roofCol.setRGB(0.15, 0.19, 0.17).multiplyScalar(0.9 + 0.2 * rnd(seed + 8));
    }
  }

  // --- walls: the shader counts storeys from baseY and finds the cornice from topY (the eaves)
  const surf = glass ? CURTAIN : monument ? VMONUMENT : VIENNA;
  b.setBase(gmax, wallTop);
  const total = wallTop - gmax;
  // storey heights are fixed here, not hashed in the shader, so the geometry can follow them: a rusticated ground
  // floor and a mezzanine in a greyer, darker stone than the plaster above, with a moulding at each joint (aux = top
  // of the mezzanine; the shader reads it)
  const banded = !glass && total >= 8 && bottom < gmax + 1;
  const yG = Math.min(3.9 + 0.9 * rnd(seed + 51), total * 0.45);
  const mz = total >= 17;
  const yMtop = yG + (mz ? 3.2 : 0);
  const yPtop = yMtop + (total >= 10.5 ? 4.8 * (monument ? 1.1 : 1) : 0);
  if (banded) b.setAux(yMtop);
  const baseCol = wall.clone().lerp(srgb(0.6, 0.58, 0.54), monument ? 0.3 : 0.5).multiplyScalar(monument ? 0.9 : 0.84);
  const stoneLight = wall.clone().lerp(srgb(0.93, 0.91, 0.85), 0.6).multiplyScalar(1.04);
  const stoneShade = wall.clone().multiplyScalar(0.55);
  const centre = new THREE.Vector3(cx, (bottom + wallTop) / 2, cz);
  for (let i = 0; i < local.length; i++) {
    const p = local[i], q = local[(i + 1) % local.length];
    const e = new THREE.Vector2().subVectors(q, p);
    const len = e.length();
    if (len < 1e-3) continue;
    // each wall faces away from a point just inside it (a concave footprint would flip a single centre)
    const inside = new THREE.Vector3((p.x + q.x) / 2 - (e.y * sgn / len) * 30, (bottom + wallTop) / 2, (p.y + q.y) / 2 + (e.x * sgn / len) * 30);
    const yS = banded ? gmax + yMtop : bottom;
    if (banded) b.quad(new THREE.Vector3(p.x, bottom, p.y), new THREE.Vector3(q.x, bottom, q.y), new THREE.Vector3(q.x, yS, q.y), new THREE.Vector3(p.x, yS, p.y), baseCol, surf, inside);
    b.quad(new THREE.Vector3(p.x, yS, p.y), new THREE.Vector3(q.x, yS, q.y), new THREE.Vector3(q.x, wallTop, q.y), new THREE.Vector3(p.x, wallTop, p.y), wall, surf, inside);
  }
  const bigBlock = !glass && total > 6 && area > 25;
  if (bigBlock) {
    // projections: a risalit in the middle of the longest fronts, bays at the corners, mouldings at the storey joints
    const pTop = wallTop - (total >= 17 ? 2.2 : 1.4);
    const yb = bottom;
    let order = local.map((_, i) => i).sort((a, c) => local[(c + 1) % local.length].distanceTo(local[c]) - local[(a + 1) % local.length].distanceTo(local[a]));
    order = order.slice(0, monument ? 3 : 1);
    for (const i of order) {
      const len = local[i].distanceTo(local[(i + 1) % local.length]);
      if (len < (monument ? 20 : 24)) continue;
      const w = Math.min(len * 0.36, monument ? 16 : 12), t0 = (len - w) / 2;
      const depth = monument ? 1.1 : 0.75;
      if (banded) projection(b, local, sgn, i, t0, t0 + w, depth, yb, gmax + yMtop, baseCol, surf);
      projection(b, local, sgn, i, t0, t0 + w, depth, banded ? gmax + yMtop : yb, pTop, wall, surf);
      if (monument && total > 14 && !part) pediment(b, local, sgn, i, t0, t0 + w, wallTop, stoneLight, roofCol);
    }
    quoins(b, local, sgn, banded ? gmax + yMtop : yb, pTop, 0.5, 2.6, wall, surf, 9);
    if (banded && mz) ledge(b, local, sgn, gmax + yMtop - 0.15, 0.5, 0.34, stoneLight, stoneShade, 5);
    if (banded && total >= 10.5) ledge(b, local, sgn, gmax + yPtop - 0.2, 0.55, 0.5, stoneLight, stoneShade, 5);
    // the main cornice: heavy enough to throw a shadow band down the wall at noon
    cornice(b, local, sgn, wallTop, wall, total >= 17 ? 1.9 : 1.2);
  }
  b.setAux(0);

  // --- corner turret with a small dome on some corner blocks
  if (!glass && !monument && !part && area > 260 && total >= 17 && kind !== 'dome' && kind !== 'onion' && kind !== 'spire' && rnd(seed + 40) < 0.22) {
    const n = local.length;
    const nor = outNormals(local, sgn);
    const start = Math.floor(rnd(seed + 44) * n);
    for (let k = 0; k < n; k++) {
      const i = (start + k) % n;
      const prev = (i - 1 + n) % n;
      const l0 = local[prev].distanceTo(local[i]), l1 = local[i].distanceTo(local[(i + 1) % n]);
      if (l0 < 10 || l1 < 10 || nor[prev].dot(nor[i]) > 0.5 || nor[prev].dot(nor[i]) < -0.35) continue;
      const e0 = new THREE.Vector2().subVectors(local[i], local[prev]), e1 = new THREE.Vector2().subVectors(local[(i + 1) % n], local[i]);
      if ((e0.x * e1.y - e0.y * e1.x) * sgn <= 0) continue;
      const slate = rnd(seed + 45) > 0.45 ? VERDIGRIS : srgb(0.22, 0.24, 0.27);
      turret(b, local, sgn, i, wallTop, wall, slate, seed);
      b.setBase(gmax, wallTop);
      break;
    }
  }

  // --- roof
  const roofCentre = new THREE.Vector3(cx, wallTop - 50, cz);
  let top: { ring: THREE.Vector2[]; y: number } | null = null;
  const statues = monument && area > 250 && total > 8;
  if (statues && kind !== 'dome' && kind !== 'onion') balustrade(b, local, sgn, wallTop - 0.3, seed, true, stoneLight);
  if (kind === 'dome' || kind === 'onion') {
    capRoof(b, local, cx, cz, wallTop, rise, kind === 'dome' ? DOME : ONION, roofCol);
    return;
  }
  if (kind === 'spire') {
    // a spire on a wide footprint is a steeple with a flared eave, not a pyramid
    if (sizeM > 9) capRoof(b, local, cx, cz, wallTop, Math.min(rise, sizeM * 1.15, 13), SPIRE, roofCol);
    else {
      const apex = new THREE.Vector3(cx, wallTop + rise, cz);
      for (let i = 0; i < local.length; i++) {
        const p = local[i], q = local[(i + 1) % local.length];
        b.tri(new THREE.Vector3(p.x, wallTop, p.y), new THREE.Vector3(q.x, wallTop, q.y), apex, roofCol, VROOF, roofCentre);
      }
    }
    return;
  }
  if (area < 900 && (kind === 'gable' || (kind === 'hip' && area < 260 && rise > 0))) {
    if (ridgeRoof(b, local, wallTop, Math.min(rise, Math.sqrt(area) * 0.45), kind === 'hip', roofCol, wall, surf, centre)) return;
    kind = 'hip';
  }
  let perim = 0;
  for (let i = 0; i < local.length; i++) perim += local[i].distanceTo(local[(i + 1) % local.length]);
  let dormerStage: [number, number, number] | null = null;
  if (kind === 'mansard') {
    // steep lower slope with the dormers, then a shallow one, then a flat top
    const R = Math.max(rise, 2.5);
    const d1 = Math.min(R * 0.5, 2.4), dy1 = R * 0.78;
    top = roofStages(b, local, sgn, wallTop, [[d1, dy1], [Math.min(R * 0.7, 3.2), R * 0.22]], roofCol, roofCentre);
    if (!top) kind = 'hip';
    else dormerStage = [d1, dy1, 4.6];
  }
  if (kind === 'hip') {
    const d = Math.min(7, Math.max(1.2, (0.8 * area) / perim));
    const pitch = THREE.MathUtils.degToRad(27 + rnd(seed + 11) * 8);
    const dy = rise > 0 && bld.roofHeight !== undefined && area < 900 ? Math.min(rise, d * 1.6) : d * Math.tan(pitch);
    if (area > 900 && d > 4) {
      // a broad roof (University, museums): a steeper outer slope, then a gentle one under the deck
      top = roofStages(b, local, sgn, wallTop, [[d * 0.55, dy * 0.75], [d * 0.45, dy * 0.25]], roofCol, roofCentre);
    } else top = roofStages(b, local, sgn, wallTop, [[d, dy]], roofCol, roofCentre);
    if (top && !part && !monument && d > 2 && rnd(seed + 46) < 0.75) dormerStage = [d, dy, 5.4];
  }
  if (!top) {
    // flat deck a little under the parapet (the walls and the cornice stand a bit above it)
    const deck = wallTop - 0.25;
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(local.map((p) => p.clone()), [])) {
      b.tri(new THREE.Vector3(local[i].x, deck, local[i].y), new THREE.Vector3(local[j].x, deck, local[j].y), new THREE.Vector3(local[k].x, deck, local[k].y), DECK, TRIM, roofCentre);
    }
    deckDetail(b, local, deck, area, seed, srgb(0.3, 0.31, 0.33));
    return;
  }
  b.setBase(gmax, wallTop);
  if (dormerStage) dormers(b, local, sgn, wallTop, dormerStage[1], dormerStage[0], dormerStage[2], roofCol, seed, 14);
  deckDetail(b, top.ring, top.y, area, seed + 5, srgb(0.3, 0.31, 0.33));
  // brick chimney stacks on the big roofs: two or three in a row along the long side
  if (area > 140 && top.ring.length >= 3 && !part) {
    const dir = new THREE.Vector2().subVectors(local[1], local[0]).normalize();
    const n = 2 + Math.floor(rnd(seed + 13) * 2);
    for (let k = 0; k < n; k++) {
      const u = (k + 0.5) / n - 0.5;
      const x = cx + dir.x * u * sizeM * 0.9 + (rnd(seed + 14 + k) - 0.5) * 3;
      const z = cz + dir.y * u * sizeM * 0.9 + (rnd(seed + 17 + k) - 0.5) * 3;
      if (![[0, 0], [1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]].every(([ax, az]) => pointInRing(top.ring, x + ax, z + az))) continue;
      const h = 2.3 + rnd(seed + 20 + k) * 1.4;
      post(b, x, z, dir, 0.6, 0.45, top.y - 0.4, top.y + h, BRICK);
    }
  }
}

/** A triangular pediment over a central risalit: the gable end of the roof above the cornice. */
function pediment(
  b: Builder, ring: THREE.Vector2[], sgn: number, i: number, t0: number, t1: number, wallTop: number, stone: THREE.Color, roof: THREE.Color,
) {
  const p = ring[i], q = ring[(i + 1) % ring.length];
  const e = new THREE.Vector2().subVectors(q, p).normalize();
  const o = outNormals(ring, sgn)[i];
  const A = p.clone().addScaledVector(e, t0 - 0.4).addScaledVector(o, 1.1), B = p.clone().addScaledVector(e, t1 + 0.4).addScaledVector(o, 1.1);
  const M = A.clone().add(B).multiplyScalar(0.5);
  const hgt = A.distanceTo(B) * 0.13;
  const back = (v: THREE.Vector2, k: number) => v.clone().addScaledVector(o, -k);
  const y = wallTop - 0.3;
  const behind = new THREE.Vector3(M.x - o.x * 20, y + 1, M.y - o.y * 20);
  b.tri(V3(A, y), V3(B, y), V3(M, y + hgt), stone, TRIM, behind);
  const ra = V3(back(A, 3), y), rb = V3(back(B, 3), y), rm = V3(back(M, 3), y + hgt);
  const low = new THREE.Vector3(M.x, y - 30, M.y);
  b.quad(V3(A, y), V3(M, y + hgt), rm, ra, roof, TRIM, low);
  b.quad(V3(B, y), V3(M, y + hgt), rm, rb, roof, TRIM, low);
}
