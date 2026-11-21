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

function edgeNormals(ring: THREE.Vector2[], sgn: number): THREE.Vector2[] {
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
function insetRing(ring: THREE.Vector2[], sgn: number, d: number): THREE.Vector2[] | null {
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
  b: Builder, local: THREE.Vector2[], cx: number, cz: number, y0: number, h: number, profile: [number, number][], col: THREE.Color,
) {
  const rc = new THREE.Vector3(cx, y0 - 50, cz);
  const ringAt = (s: number, y: number) => local.map((p) => new THREE.Vector3(cx + (p.x - cx) * s, y, cz + (p.y - cz) * s));
  let prev = ringAt(profile[0][0], y0 + profile[0][1] * h);
  for (let k = 1; k < profile.length; k++) {
    const [s, f] = profile[k];
    const cur = ringAt(s, y0 + f * h);
    for (let i = 0; i < prev.length; i++) {
      const j = (i + 1) % prev.length;
      if (s < 0.01) b.tri(prev[i], prev[j], cur[i], col, VROOF, rc);
      else b.quad(prev[i], prev[j], cur[j], cur[i], col, VROOF, rc);
    }
    prev = cur;
  }
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
  const centre = new THREE.Vector3(cx, (bottom + wallTop) / 2, cz);
  for (let i = 0; i < local.length; i++) {
    const p = local[i], q = local[(i + 1) % local.length];
    const e = new THREE.Vector2().subVectors(q, p);
    const len = e.length();
    if (len < 1e-3) continue;
    // each wall faces away from a point just inside it (a concave footprint would flip a single centre)
    const inside = new THREE.Vector3((p.x + q.x) / 2 - (e.y * sgn / len) * 30, (bottom + wallTop) / 2, (p.y + q.y) / 2 + (e.x * sgn / len) * 30);
    b.quad(new THREE.Vector3(p.x, bottom, p.y), new THREE.Vector3(q.x, bottom, q.y), new THREE.Vector3(q.x, wallTop, q.y), new THREE.Vector3(p.x, wallTop, p.y), wall, surf, inside);
  }
  if (!glass && wallTop - bottom > 6 && area > 25) cornice(b, local, sgn, wallTop, wall);

  // --- roof
  const roofCentre = new THREE.Vector3(cx, wallTop - 50, cz);
  let top: { ring: THREE.Vector2[]; y: number } | null = null;
  if (kind === 'dome' || kind === 'onion') {
    capRoof(b, local, cx, cz, wallTop, rise, kind === 'dome' ? DOME : ONION, roofCol);
    return;
  }
  if (kind === 'spire') {
    const apex = new THREE.Vector3(cx, wallTop + rise, cz);
    for (let i = 0; i < local.length; i++) {
      const p = local[i], q = local[(i + 1) % local.length];
      b.tri(new THREE.Vector3(p.x, wallTop, p.y), new THREE.Vector3(q.x, wallTop, q.y), apex, roofCol, VROOF, roofCentre);
    }
    return;
  }
  if (kind === 'gable' || (kind === 'hip' && area < 260 && rise > 0)) {
    if (ridgeRoof(b, local, wallTop, Math.min(rise, Math.sqrt(area) * 0.45), kind === 'hip', roofCol, wall, surf, centre)) return;
    kind = 'hip';
  }
  let perim = 0;
  for (let i = 0; i < local.length; i++) perim += local[i].distanceTo(local[(i + 1) % local.length]);
  if (kind === 'mansard') {
    // steep lower slope with the dormers, then a shallow one, then a flat top
    const R = Math.max(rise, 2.5);
    top = roofStages(b, local, sgn, wallTop, [[Math.min(R * 0.5, 2.4), R * 0.78], [Math.min(R * 0.7, 3.2), R * 0.22]], roofCol, roofCentre);
    if (!top) kind = 'hip';
  }
  if (kind === 'hip') {
    const d = Math.min(7, Math.max(1.2, (0.8 * area) / perim));
    const pitch = THREE.MathUtils.degToRad(27 + rnd(seed + 11) * 8);
    top = roofStages(b, local, sgn, wallTop, [[d, rise > 0 && bld.roofHeight !== undefined ? Math.min(rise, d * 1.6) : d * Math.tan(pitch)]], roofCol, roofCentre);
  }
  if (!top) {
    // flat deck a little under the parapet (the walls and the cornice stand a bit above it)
    const deck = wallTop - 0.25;
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(local.map((p) => p.clone()), [])) {
      b.tri(new THREE.Vector3(local[i].x, deck, local[i].y), new THREE.Vector3(local[j].x, deck, local[j].y), new THREE.Vector3(local[k].x, deck, local[k].y), DECK, TRIM, roofCentre);
    }
    return;
  }
  // brick chimney stacks on the big roofs: two or three in a row along the long side
  if (area > 140 && top.ring.length >= 3 && !part) {
    const dir = new THREE.Vector2().subVectors(local[1], local[0]).normalize();
    const n = 2 + Math.floor(rnd(seed + 13) * 2);
    for (let k = 0; k < n; k++) {
      const u = (k + 0.5) / n - 0.5;
      const x = cx + dir.x * u * sizeM * 0.9 + (rnd(seed + 14 + k) - 0.5) * 3;
      const z = cz + dir.y * u * sizeM * 0.9 + (rnd(seed + 17 + k) - 0.5) * 3;
      if (![[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].every(([ax, az]) => pointInRing(top.ring, x + ax, z + az))) continue;
      b.box(x, z, dir, 0.5, 0.4, top.y - 0.3, top.y + 1.6 + rnd(seed + 20 + k) * 0.8, BRICK, TRIM);
    }
  }
}
