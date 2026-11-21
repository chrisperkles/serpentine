// OSM building footprints → merged meshes in the regional style of the Salzburg Flachgau:
// white plaster ground floor, weathered larch upper storey or gable, wide roof overhangs,
// gabled / hipped / half-hipped (Krüppelwalm) roofs from roof:shape, a wooden balcony with
// geranium boxes on the gable front. Windows, shutters, planks and roof tiles are drawn in
// the shader from a per-vertex surface id.

import * as THREE from 'three';
import type { Building, OsmWorld } from '../geo/osm.ts';
import type { RouteIndex } from '../geo/route.ts';
import { patchMaterial } from './atmosphere.ts';
import { ALPINE, type Biome } from './biome.ts';
import { WorldGroup } from './dispose.ts';
import { addViennaBlock, insetRing, ledge, outNormals, projection, quoins, VIENNA_ROOFS, VIENNA_WALLS, VROOF } from './ViennaBlock.ts';

const BUCKET = 600;

// surface ids (vertex attribute `surf`)
const PLASTER = 0, WOOD = 1, ROOF = 2, TRIM = 3, FLOWERS = 4, GLASSWALL = 5, TIMBER = 6, MALLORCA = 7, MARES = 8, MASONRY = 9, CURTAIN = 10;
// Sydney: brick cottage walls, rendered Art Deco and shop walls, brick walk-up flats with balconies
const SYD_BRICK = 14, SYD_RENDER = 15, SYD_FLATS = 16;

const srgb = (r: number, g: number, b: number) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
const WALLS = [srgb(0.95, 0.93, 0.88), srgb(0.97, 0.96, 0.93), srgb(0.93, 0.88, 0.76), srgb(0.9, 0.9, 0.87), srgb(0.95, 0.9, 0.82)];
const WOODS = [srgb(0.42, 0.29, 0.18), srgb(0.36, 0.25, 0.16), srgb(0.5, 0.36, 0.23)];
const ROOFS = [srgb(0.42, 0.2, 0.14), srgb(0.33, 0.19, 0.14), srgb(0.27, 0.27, 0.28), srgb(0.5, 0.24, 0.16), srgb(0.36, 0.36, 0.37)];
const GERANIUM = srgb(0.86, 0.1, 0.12);
// Mallorca: lime render in cream/ochre, marès sandstone, terracotta 'teula' roofs
const MED_WALLS = [srgb(0.95, 0.92, 0.84), srgb(0.97, 0.95, 0.9), srgb(0.9, 0.8, 0.62), srgb(0.93, 0.86, 0.72), srgb(0.86, 0.72, 0.52)];
const MED_ROOFS = [srgb(0.68, 0.38, 0.24), srgb(0.6, 0.34, 0.22), srgb(0.72, 0.45, 0.3)];
// Savoie / Dauphiné ski resorts (Alpe d'Huez): white and beige render or concrete, grey slate and
// steel roofs, timber upper storeys and plain timber balconies, brown shutters, no geraniums
const SAVOIE_WALLS = [srgb(0.92, 0.9, 0.85), srgb(0.86, 0.83, 0.77), srgb(0.8, 0.78, 0.74), srgb(0.9, 0.86, 0.78)];
const SAVOIE_ROOFS = [srgb(0.3, 0.3, 0.31), srgb(0.36, 0.35, 0.34), srgb(0.25, 0.25, 0.26), srgb(0.4, 0.35, 0.3)];
// Provence (Bédoin, Malaucène): warm stone and ochre render, faded canal-tile roofs
const PROV_WALLS = [srgb(0.88, 0.8, 0.66), srgb(0.92, 0.86, 0.74), srgb(0.84, 0.74, 0.6), srgb(0.9, 0.79, 0.62), srgb(0.8, 0.7, 0.58)];
const PROV_ROOFS = [srgb(0.74, 0.5, 0.38), srgb(0.68, 0.44, 0.32), srgb(0.78, 0.56, 0.43)];

// Manhattan around Central Park: pre-war apartment houses in limestone, buff, red and brown brick,
// white-brick post-war slabs, brownstone row houses on the side streets; glass towers in Midtown
const NYC_MASONRY = [
  srgb(0.8, 0.77, 0.7), srgb(0.76, 0.67, 0.54), srgb(0.72, 0.62, 0.5), srgb(0.5, 0.31, 0.25), srgb(0.44, 0.33, 0.28),
  srgb(0.85, 0.84, 0.8), srgb(0.66, 0.64, 0.6), srgb(0.7, 0.55, 0.42),
];
const NYC_ROWHOUSE = [srgb(0.43, 0.3, 0.25), srgb(0.5, 0.29, 0.23), srgb(0.38, 0.27, 0.23), srgb(0.72, 0.68, 0.6)];
const NYC_GLASS = [srgb(0.36, 0.46, 0.53), srgb(0.24, 0.3, 0.34), srgb(0.5, 0.58, 0.6), srgb(0.17, 0.19, 0.22), srgb(0.42, 0.5, 0.48)];
const NYC_ROOFS = [srgb(0.3, 0.3, 0.31), srgb(0.42, 0.41, 0.4), srgb(0.24, 0.24, 0.25), srgb(0.55, 0.54, 0.52)];
const COPPER = srgb(0.43, 0.62, 0.54);
const TANK_WOOD = srgb(0.36, 0.27, 0.2);

/** A region's houses (biome `buildings`; scenes can override it through `biomeTweaks`). */
interface Style {
  /** Mediterranean massing: low tile roofs, short eaves, render or ashlar with louvred shutters. */
  med: boolean;
  /** Bigger untagged blocks get flat roof terraces (Mallorca); elsewhere houses keep tile roofs. */
  flatTowns: boolean;
  walls: THREE.Color[];
  roofs: THREE.Color[];
  /** Share of rural houses with a timber upper storey. */
  woodTop: number;
  /** Balcony on a gable front: with geranium boxes, plain timber, or none. */
  balcony: 'geranium' | 'plain' | 'none';
  /** Roof pitch range of houses, degrees (Alpine barns are 30°). */
  pitch: [number, number];
  /** Shutter colours, one per house (linear RGB). */
  shutters: [THREE.Vector3, THREE.Vector3];
  /** City blocks (Manhattan): flat-roofed masonry and glass, drawn from 3D parts where OSM has them. */
  city?: boolean;
  /** Sydney's eastern suburbs: brick bungalows, Art Deco and walk-up flats, shop terraces (addSydneyBuilding). */
  sydney?: boolean;
  /** Vienna Ringstrasse historicism (ViennaBlock.ts, facade surfaces 11-13). */
  vienna?: boolean;
}

const V = (r: number, g: number, b: number) => new THREE.Vector3(r, g, b);
const STYLES: Record<Biome['buildings'], Style> = {
  flachgau: {
    med: false, flatTowns: false, walls: WALLS, roofs: ROOFS, woodTop: 0.55, balcony: 'geranium', pitch: [24, 30],
    shutters: [V(0.13, 0.27, 0.16), V(0.3, 0.19, 0.11)],
  },
  mallorca: {
    med: true, flatTowns: true, walls: MED_WALLS, roofs: MED_ROOFS, woodTop: 0, balcony: 'none', pitch: [17, 23],
    shutters: [V(0.16, 0.33, 0.24), V(0.16, 0.33, 0.24)],
  },
  savoie: {
    med: false, flatTowns: false, walls: SAVOIE_WALLS, roofs: SAVOIE_ROOFS, woodTop: 0.7, balcony: 'plain', pitch: [18, 25],
    shutters: [V(0.3, 0.19, 0.11), V(0.22, 0.15, 0.1)],
  },
  // shutters in the faded Provençal blue-grey and sage
  provence: {
    med: true, flatTowns: false, walls: PROV_WALLS, roofs: PROV_ROOFS, woodTop: 0, balcony: 'none', pitch: [17, 23],
    shutters: [V(0.26, 0.38, 0.44), V(0.32, 0.39, 0.26)],
  },
  manhattan: {
    med: false, flatTowns: true, walls: NYC_MASONRY, roofs: NYC_ROOFS, woodTop: 0, balcony: 'none', pitch: [20, 25],
    shutters: [V(0.2, 0.2, 0.2), V(0.2, 0.2, 0.2)], city: true,
  },
  sydney: {
    med: false, flatTowns: true, walls: WALLS, roofs: ROOFS, woodTop: 0, balcony: 'none', pitch: [24, 30],
    shutters: [V(0.2, 0.2, 0.2), V(0.2, 0.2, 0.2)], sydney: true,
  },
  vienna: {
    med: false, flatTowns: true, walls: VIENNA_WALLS, roofs: VIENNA_ROOFS, woodTop: 0, balcony: 'none', pitch: [27, 35],
    shutters: [V(0.2, 0.2, 0.2), V(0.2, 0.2, 0.2)], city: true, vienna: true,
  },
};

export function rnd(seed: number) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

export function parseColour(c: string | undefined, fallback: THREE.Color): THREE.Color {
  if (!c) return fallback;
  try {
    return new THREE.Color().setStyle(c, THREE.SRGBColorSpace);
  } catch {
    return fallback;
  }
}

export class Builder {
  pos: number[] = [];
  col: number[] = [];
  surf: number[] = [];
  base: number[] = [];
  top: number[] = [];
  /** Per-vertex extra the facade shader reads (`aux`): Manhattan masonry: height of the stone base (negative: an upper block with no street floor); Vienna: top of the mezzanine; curtain walls: the tower's character. */
  aux: number[] = [];
  private y0 = 0;
  private y1 = 0;
  private a = 0;
  setAux(v: number) {
    this.a = v;
  }
  /** Ground level and roof level of the block being built (the shader counts floors and draws the cornice from them). */
  setBase(y: number, top = y) {
    this.y0 = y;
    this.y1 = top;
  }
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, color: THREE.Color, s: number, centre: THREE.Vector3) {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    const mid = new THREE.Vector3().add(a).add(b).add(c).multiplyScalar(1 / 3).sub(centre);
    const pts = n.dot(mid) < 0 ? [a, c, b] : [a, b, c];
    for (const p of pts) {
      this.pos.push(p.x, p.y, p.z);
      this.col.push(color.r, color.g, color.b);
      this.surf.push(s);
      this.base.push(this.y0);
      this.top.push(this.y1);
      this.aux.push(this.a);
    }
  }
  /** Upright cylinder with a cone cap (a rooftop water tank). */
  tank(cx: number, cz: number, r: number, y0: number, y1: number, cap: number, color: THREE.Color, s: number) {
    const c = new THREE.Vector3(cx, (y0 + y1) / 2, cz);
    const apex = new THREE.Vector3(cx, y1 + cap, cz);
    const N = 10;
    const P = (i: number, y: number) => new THREE.Vector3(cx + Math.cos((i / N) * Math.PI * 2) * r, y, cz + Math.sin((i / N) * Math.PI * 2) * r);
    for (let i = 0; i < N; i++) {
      this.quad(P(i, y0), P(i + 1, y0), P(i + 1, y1), P(i, y1), color, s, c);
      this.tri(P(i, y1), P(i + 1, y1), apex, color, s, new THREE.Vector3(cx, y1 - 50, cz));
    }
  }
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, color: THREE.Color, s: number, centre: THREE.Vector3) {
    this.tri(a, b, c, color, s, centre);
    this.tri(a, c, d, color, s, centre);
  }
  /** Axis-aligned-in-plan box given by centre, half extents along dir/perp, y range. */
  box(cx: number, cz: number, dir: THREE.Vector2, hu: number, hv: number, y0: number, y1: number, color: THREE.Color, s: number) {
    const perp = new THREE.Vector2(-dir.y, dir.x);
    const P = (u: number, v: number, y: number) => new THREE.Vector3(cx + dir.x * u + perp.x * v, y, cz + dir.y * u + perp.y * v);
    const c = new THREE.Vector3(cx, (y0 + y1) / 2, cz);
    const corners = [[-hu, -hv], [hu, -hv], [hu, hv], [-hu, hv]];
    for (let i = 0; i < 4; i++) {
      const [u0, v0] = corners[i];
      const [u1, v1] = corners[(i + 1) % 4];
      this.quad(P(u0, v0, y0), P(u1, v1, y0), P(u1, v1, y1), P(u0, v0, y1), color, s, c);
    }
    this.quad(P(-hu, -hv, y1), P(hu, -hv, y1), P(hu, hv, y1), P(-hu, hv, y1), color, s, c);
    this.quad(P(-hu, -hv, y0), P(hu, -hv, y0), P(hu, hv, y0), P(-hu, hv, y0), color, s, c);
  }
}

export function simplify(ring: Float32Array): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) pts.push(new THREE.Vector2(ring[i * 2], ring[i * 2 + 1]));
  const out: THREE.Vector2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[(i - 1 + pts.length) % pts.length];
    const c = pts[i];
    const nx = pts[(i + 1) % pts.length];
    const cross = (c.x - p.x) * (nx.y - c.y) - (c.y - p.y) * (nx.x - c.x);
    if (Math.abs(cross) > 0.4 * p.distanceTo(c) * c.distanceTo(nx) * 0.05 || pts.length <= 4) out.push(c);
  }
  return out.length >= 3 ? out : pts;
}

function addBuilding(
  bld: Building, b: Builder, heightAt: (x: number, z: number) => number, seed: number, ox: number, oz: number, style: Style,
) {
  if (style.vienna) return addViennaBlock(bld, b, heightAt, seed, ox, oz);
  if (style.city) return addManhattanBlock(bld, b, heightAt, seed, ox, oz);
  if (style.sydney) return addSydneyBuilding(bld, b, heightAt, seed, ox, oz);
  const med = style.med;
  const ring = simplify(bld.ring);
  if (ring.length < 3) return;
  let gmin = Infinity;
  let gmax = -Infinity;
  for (const p of ring) {
    const h = heightAt(p.x, p.y);
    if (!Number.isFinite(h)) return;
    gmin = Math.min(gmin, h);
    gmax = Math.max(gmax, h);
  }
  const base = gmin - 0.6;
  b.setBase(gmax);
  // Mallorca: small rural houses have low hipped/gabled tile roofs, town blocks are flat with terraces
  let roofShape = bld.roof;
  if (style.flatTowns && !bld.explicitRoof) {
    let ar = 0;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      ar += p.x * q.y - q.x * p.y;
    }
    roofShape = Math.abs(ar) / 2 < 220 ? (rnd(seed + 21) > 0.5 ? 'hipped' : 'gabled') : 'flat';
  }
  // churches and chapels: a steep white nave and, on parish churches, a tower with a spire
  const church = ['church', 'chapel', 'cathedral'].includes(bld.kind) ||
    /kirche|church|église|eglise|chiesa|kapelle|chapelle|cappella/i.test(bld.name ?? '');
  if (church && !bld.explicitRoof) roofShape = 'gabled';
  const pitched = roofShape !== 'flat';
  const levels = bld.levels ?? Math.max(1, Math.round((bld.height - (pitched ? 2.5 : 0)) / 3));
  const wallTop = gmax + Math.max(2.8, levels * 2.9 + 0.4);
  const local = ring.map((p) => new THREE.Vector2(p.x - ox, p.y - oz));
  const cx = local.reduce((s, p) => s + p.x, 0) / local.length;
  const cz = local.reduce((s, p) => s + p.y, 0) / local.length;
  const centre = new THREE.Vector3(cx, (base + wallTop) / 2, cz);
  const barn = ['barn', 'farm_auxiliary', 'hut', 'cabin', 'shed', 'stable', 'cowshed'].includes(bld.kind);
  const big = ['apartments', 'commercial', 'industrial', 'retail', 'office', 'school', 'public', 'hospital'].includes(bld.kind);
  // mountain huts and inns (Goasn Alm, Gersbergalm, the Alpenhaus on the Kitzbüheler Horn…): all-timber
  // chalets with shingle roofs
  const alm = !big && (/alm|hütte|huette|goasn|alpenhaus|berghaus/i.test(bld.name ?? '') || bld.kind === 'hut' || bld.kind === 'cabin');
  const wood = WOODS[Math.floor(rnd(seed + 5) * WOODS.length)];
  const wallSet = style.walls;
  const wall = parseColour(bld.wallColour, barn && !med ? wood : wallSet[Math.floor(rnd(seed) * wallSet.length)]).clone();
  const roofSet = style.roofs;
  const roofCol = parseColour(
    bld.roofColour,
    church ? srgb(0.33, 0.34, 0.36) : alm && !med ? srgb(0.33, 0.29, 0.25) : roofSet[Math.floor(rnd(seed + 7) * roofSet.length)],
  );
  // farmhouse look: wooden upper storey on many rural houses
  const woodTop = bld.woodTop ?? (!med && !barn && !big && !alm && !church && pitched && levels >= 2 && rnd(seed + 3) > 1 - style.woodTop);
  const split = woodTop ? wallTop - 2.7 : wallTop;
  // rural Mallorcan houses are often bare marès / limestone masonry
  const mares = med && (barn || (pitched && rnd(seed + 9) > 0.55));
  // industrial blocks (the base of the Mont Ventoux transmitter), utility buildings (substations) and
  // site containers are bare concrete or metal, never a house
  const plant = bld.kind === 'industrial' || bld.kind === 'container' || bld.kind === 'service';
  const wallSurf = plant || church ? TRIM : med ? (mares ? MARES : MALLORCA) : alm ? TIMBER : barn ? WOOD : big && levels > 3 ? GLASSWALL : PLASTER;
  if (plant && !bld.wallColour) wall.copy(srgb(0.84, 0.84, 0.82));
  if (church && !bld.wallColour) wall.copy(srgb(0.94, 0.93, 0.89));
  if (mares) wall.copy(srgb(0.8, 0.7, 0.55));
  if (alm && !med && !bld.wallColour) wall.copy(srgb(0.46, 0.36, 0.27));

  for (let i = 0; i < local.length; i++) {
    const p = local[i];
    const q = local[(i + 1) % local.length];
    b.quad(new THREE.Vector3(p.x, base, p.y), new THREE.Vector3(q.x, base, q.y), new THREE.Vector3(q.x, split, q.y), new THREE.Vector3(p.x, split, p.y), wall, wallSurf, centre);
    if (woodTop) {
      b.quad(new THREE.Vector3(p.x, split, p.y), new THREE.Vector3(q.x, split, q.y), new THREE.Vector3(q.x, wallTop, q.y), new THREE.Vector3(p.x, wallTop, p.y), wood, WOOD, centre);
    }
  }

  // oriented bounding rectangle along the longest edge
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
    const u = p.x * dir.x + p.y * dir.y;
    const v = p.x * perp.x + p.y * perp.y;
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
  }
  let area = 0;
  for (let i = 0; i < local.length; i++) {
    const p = local[i], q = local[(i + 1) % local.length];
    area += p.x * q.y - q.x * p.y;
  }
  area = Math.abs(area) / 2;
  const rectArea = (u1 - u0) * (v1 - v0);
  const rectish = area / rectArea > 0.78 && v1 - v0 < 34;

  // church tower over one end of the long axis: plain white shaft, a slate spire
  if (church && area > 110) {
    const vm = (v0 + v1) / 2;
    const Q = (u: number, v: number, y: number) => new THREE.Vector3(dir.x * u + perp.x * v, y, dir.y * u + perp.y * v);
    const side = Math.min(7, Math.max(3.5, (v1 - v0) * 0.45));
    const tu = u0 + side / 2;
    const tcx = dir.x * tu + perp.x * vm, tcz = dir.y * tu + perp.y * vm;
    const towerTop = gmax + Math.max(16, (wallTop - gmax) * 2.4 + 6);
    b.box(tcx, tcz, dir, side / 2, side / 2, base, towerTop, wall, TRIM);
    const apex = Q(tu, vm, towerTop + side * 1.9);
    const k = [Q(u0, vm - side / 2, towerTop), Q(u0 + side, vm - side / 2, towerTop), Q(u0 + side, vm + side / 2, towerTop), Q(u0, vm + side / 2, towerTop)];
    const sc = new THREE.Vector3(tcx, towerTop, tcz);
    for (let i = 0; i < 4; i++) b.tri(k[i], k[(i + 1) % 4], apex, roofCol, ROOF, sc);
  }

  if (pitched && rectish) {
    const P = (u: number, v: number, y: number) => new THREE.Vector3(dir.x * u + perp.x * v, y, dir.y * u + perp.y * v);
    const half = (v1 - v0) / 2;
    const vm = (v0 + v1) / 2;
    // Flachgau roofs are fairly flat (~25°) with deep overhangs
    const pitch = THREE.MathUtils.degToRad(
      church ? 44 : barn && !med ? 30 : style.pitch[0] + rnd(seed + 11) * (style.pitch[1] - style.pitch[0]),
    );
    const rise = Math.min(half * Math.tan(pitch), 7);
    const ovE = med ? 0.35 : Math.min(1.4, 0.6 + half * 0.12); // eaves
    const ovG = med ? 0.25 : Math.min(1.6, 0.8 + half * 0.12); // gable ends
    const eave = wallTop - ovE * (rise / half);
    const roofCentre = new THREE.Vector3(centre.x, wallTop - 50, centre.z);
    const thick = 0.22;
    const shape = roofShape;
    // hip run along the ridge: full hip = half, half-hip only the top third
    const hip = shape === 'hipped' ? half : shape === 'half-hipped' ? half * 0.4 : 0;
    const ridgeY = wallTop + rise;
    // hip line: where the gable is cut, as a fraction along the slope from the eave
    const f = 1 - hip / half;
    const hipY = eave + f * (ridgeY - eave);
    const hipV = (half + ovE) * (hip / half);
    const rA = P(u0 - ovG + hip, vm, ridgeY);
    const rB = P(u1 + ovG - hip, vm, ridgeY);
    const e00 = P(u0 - ovG, v0 - ovE, eave), e10 = P(u1 + ovG, v0 - ovE, eave);
    const e01 = P(u0 - ovG, v1 + ovE, eave), e11 = P(u1 + ovG, v1 + ovE, eave);
    if (hip === 0 || shape === 'skillion') {
      b.quad(e00, e10, rB, rA, roofCol, ROOF, roofCentre);
      b.quad(e01, e11, rB, rA, roofCol, ROOF, roofCentre);
      // fascia boards under the roof edge
      b.quad(e00, e10, e10.clone().setY(eave - thick), e00.clone().setY(eave - thick), wood, TRIM, centre);
      b.quad(e01, e11, e11.clone().setY(eave - thick), e01.clone().setY(eave - thick), wood, TRIM, centre);
    } else if (shape === 'hipped') {
      b.quad(e00, e10, rB, rA, roofCol, ROOF, roofCentre);
      b.quad(e01, e11, rB, rA, roofCol, ROOF, roofCentre);
      b.tri(e00, e01, rA, roofCol, ROOF, roofCentre);
      b.tri(e10, e11, rB, roofCol, ROOF, roofCentre);
    } else {
      // half-hip: gable wall up to the hip line, small hipped triangle above
      const hA0 = P(u0 - ovG, vm - hipV, hipY);
      const hA1 = P(u0 - ovG, vm + hipV, hipY);
      const hB0 = P(u1 + ovG, vm - hipV, hipY);
      const hB1 = P(u1 + ovG, vm + hipV, hipY);
      b.quad(e00, e10, hB0, hA0, roofCol, ROOF, roofCentre);
      b.quad(hA0, hB0, rB, rA, roofCol, ROOF, roofCentre);
      b.quad(e01, e11, hB1, hA1, roofCol, ROOF, roofCentre);
      b.quad(hA1, hB1, rB, rA, roofCol, ROOF, roofCentre);
      b.tri(hA0, hA1, rA, roofCol, ROOF, roofCentre);
      b.tri(hB0, hB1, rB, roofCol, ROOF, roofCentre);
    }
    // gable walls (wood on farmhouses), clipped at the hip line
    for (const u of [u0, u1]) {
      // apartment and commercial blocks have plastered gables
      const gw = !church && (woodTop || barn || (!big && rnd(seed + 13) > 0.5)) ? wood : wall;
      const gs = gw === wood ? WOOD : PLASTER;
      if (hip >= half) continue;
      if (hip > 0) {
        b.quad(P(u, v0, wallTop), P(u, v1, wallTop), P(u, vm + hipV, hipY), P(u, vm - hipV, hipY), gw, gs, centre);
      } else {
        b.tri(P(u, v0, wallTop), P(u, v1, wallTop), P(u, vm, ridgeY), gw, gs, centre);
      }
    }
    // balcony (with geraniums in the Flachgau) along one gable front of houses with an upper floor
    if (style.balcony !== 'none' && !church && !barn && !big && (levels >= 2 || alm) && (alm || rnd(seed + 17) > 0.25)) {
      const u = rnd(seed + 19) > 0.5 ? u1 : u0;
      const out = u === u1 ? 1 : -1;
      const by = gmax + 2.9;
      const depth = 1.15;
      const cu = u + out * depth / 2;
      const len = (v1 - v0) * 0.82;
      const ccx = dir.x * cu + perp.x * vm, ccz = dir.y * cu + perp.y * vm;
      b.box(ccx, ccz, dir, depth / 2, len / 2, by - 0.12, by, wood, TRIM);
      // solid board railing (typical cut-out larch boards read as solid at a distance)
      const ru = u + out * (depth - 0.04);
      const rcx = dir.x * ru + perp.x * vm, rcz = dir.y * ru + perp.y * vm;
      b.box(rcx, rcz, dir, 0.04, len / 2, by, by + 0.95, wood, WOOD);
      // flower boxes on the railing
      if (style.balcony === 'geranium') {
        const fu = u + out * (depth + 0.08);
        const fcx = dir.x * fu + perp.x * vm, fcz = dir.y * fu + perp.y * vm;
        b.box(fcx, fcz, dir, 0.11, len / 2 - 0.2, by + 0.75, by + 1.12, GERANIUM, FLOWERS);
      }
    }
  } else {
    const roofCentre = new THREE.Vector3(centre.x, wallTop - 50, centre.z);
    // a pitched Alpine roof over an odd footprint (the curved and L-shaped pass hotels): hip faces up
    // from the walls to the footprint inset by a few metres, a short flat top over that
    if (pitched && !med && hipRoof(b, local, wallTop, THREE.MathUtils.degToRad((style.pitch[0] + style.pitch[1]) / 2), roofCol, roofCentre)) return;
    const tris = THREE.ShapeUtils.triangulateShape(local, []);
    const flatRoof = med ? srgb(0.74, 0.7, 0.64) : srgb(0.38, 0.38, 0.38);
    if (med) {
      // roof terrace parapet, rendered like the walls
      for (let i = 0; i < local.length; i++) {
        const p = local[i], q = local[(i + 1) % local.length];
        b.quad(new THREE.Vector3(p.x, wallTop, p.y), new THREE.Vector3(q.x, wallTop, q.y), new THREE.Vector3(q.x, wallTop + 0.9, q.y), new THREE.Vector3(p.x, wallTop + 0.9, p.y), wall, TRIM, centre);
      }
    }
    for (const [i, j, k] of tris) {
      b.tri(
        new THREE.Vector3(local[i].x, wallTop, local[i].y),
        new THREE.Vector3(local[j].x, wallTop, local[j].y),
        new THREE.Vector3(local[k].x, wallTop, local[k].y),
        flatRoof,
        TRIM,
        roofCentre,
      );
    }
  }
}

export function pointInRing(ring: THREE.Vector2[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], c = ring[j];
    if (a.y > y !== c.y > y && x < ((c.x - a.x) * (y - a.y)) / (c.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * A Manhattan block or one 3D part of it: straight walls from the ground (or the part's min_height)
 * to the roof, a parapet, a flat roof or a pyramid top; water tank and bulkhead on plain mid-rises.
 */
function addCityBlock(bld: Building, b: Builder, heightAt: (x: number, z: number) => number, seed: number, ox: number, oz: number, sydney = false) {
  const ring = simplify(bld.ring);
  if (ring.length < 3) return;
  let gmin = Infinity, gmax = -Infinity;
  for (const p of ring) {
    const h = heightAt(p.x, p.y);
    if (!Number.isFinite(h)) return;
    gmin = Math.min(gmin, h);
    gmax = Math.max(gmax, h);
  }
  const height = Math.max(bld.height, 3.5);
  const top = gmax + height;
  const bottom = bld.minHeight !== undefined ? gmax + Math.min(bld.minHeight, height - 1) : gmin - 0.6;
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
  const centre = new THREE.Vector3(cx, (bottom + top) / 2, cz);
  const mat = bld.material;
  const tower = height > 125 || (sydney && height > 24) || ((bld.kind === 'office' || bld.kind === 'commercial') && height > 48 && rnd(seed + 2) > 0.45);
  const glass = mat === 'glass' || mat === 'metal' || mat === 'steel' || (!mat && !bld.wallColour && tower);
  const row = !bld.part && height < 21 && area < 420;
  const set = glass ? (sydney ? SYD_GLASS : NYC_GLASS) : row ? NYC_ROWHOUSE : NYC_MASONRY;
  const wall = parseColour(bld.wallColour, set[Math.floor(rnd(seed) * set.length)]).clone();
  if (glass || !bld.wallColour) {
    // tagged colours are often pure black or white: keep them inside what stone, brick and glass can be
    const hsl = { h: 0, s: 0, l: 0 };
    wall.getHSL(hsl);
    wall.setHSL(hsl.h, Math.min(hsl.s, 0.55), Math.min(Math.max(hsl.l, glass ? 0.02 : 0.05), 0.62));
  } else {
    // OSM wall colours on masonry are often garish (a lime-yellow block on Central Park West): pull the hue
    // towards brick and sandstone, keep only a loose memory of it, and cap saturation and lightness
    const hsl = { h: 0, s: 0, l: 0 };
    wall.getHSL(hsl, THREE.SRGBColorSpace);
    const dh = ((hsl.h - 0.07 + 1.5) % 1) - 0.5;
    const h = 0.07 + Math.max(-0.05, Math.min(0.05, dh * 0.4));
    wall.setHSL(h, Math.min(hsl.s * 0.8, 0.3), Math.min(Math.max(hsl.l, 0.3), 0.72), THREE.SRGBColorSpace);
  }
  const surf = glass ? CURTAIN : MASONRY;
  const pyramid = bld.roof === 'pyramidal';
  const rise = pyramid ? Math.min(bld.roofHeight ?? Math.min(Math.sqrt(area) * 0.6, 9), height - 1) : 0;
  const wallTop = top - rise;
  // the shader counts storeys and finds the cornice from the wall's own top, not the pyramid's apex
  b.setBase(gmax, wallTop);
  for (let i = 0; i < local.length; i++) {
    const p = local[i], q = local[(i + 1) % local.length];
    b.quad(new THREE.Vector3(p.x, bottom, p.y), new THREE.Vector3(q.x, bottom, q.y), new THREE.Vector3(q.x, wallTop, q.y), new THREE.Vector3(p.x, wallTop, p.y), wall, surf, centre);
  }
  if (!sydney && !glass && height > 12 && height < 160) cornice(b, local, sgn, wallTop, wall);
  const roofCentre = new THREE.Vector3(cx, wallTop - 50, cz);
  if (pyramid) {
    // copper-green or slate caps of the pre-war towers (the Pierre, the Sherry-Netherland, the San Remo lanterns)
    const cap = parseColour(bld.roofColour, rnd(seed + 4) > 0.5 ? COPPER : srgb(0.3, 0.31, 0.33));
    const apex = new THREE.Vector3(cx, top, cz);
    for (let i = 0; i < local.length; i++) {
      const p = local[i], q = local[(i + 1) % local.length];
      b.tri(new THREE.Vector3(p.x, wallTop, p.y), new THREE.Vector3(q.x, wallTop, q.y), apex, cap, TRIM, roofCentre);
    }
    return;
  }
  // the walls stand a parapet's height above the roof deck
  const deck = wallTop - (height > 8 && area > 60 ? 0.9 : 0.15);
  const roofCol = parseColour(bld.roofColour, NYC_ROOFS[Math.floor(rnd(seed + 7) * NYC_ROOFS.length)]);
  for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(local, [])) {
    b.tri(new THREE.Vector3(local[i].x, deck, local[i].y), new THREE.Vector3(local[j].x, deck, local[j].y), new THREE.Vector3(local[k].x, deck, local[k].y), roofCol, TRIM, roofCentre);
  }
  // what stands on a New York roof: the stair and lift bulkhead, and the wooden water tank on its steel
  // frame (every building over six floors needs one). Buildings mapped in parts carry their own tops.
  if (bld.part || glass || area < 160) return;
  const dir = new THREE.Vector2().subVectors(local[1], local[0]).normalize();
  const perp = new THREE.Vector2(-dir.y, dir.x);
  const spot = (du: number, dv: number, clearance: number) => {
    const x = cx + dir.x * du + perp.x * dv, z = cz + dir.y * du + perp.y * dv;
    for (const [ax, az] of [[0, 0], [clearance, 0], [-clearance, 0], [0, clearance], [0, -clearance]]) {
      if (!pointInRing(local, x + ax, z + az)) return null;
    }
    return [x, z] as const;
  };
  const span = Math.sqrt(area);
  if (height > 14) {
    const s = spot((rnd(seed + 31) - 0.5) * span * 0.3, (rnd(seed + 32) - 0.5) * span * 0.3, 3.5);
    if (s) b.box(s[0], s[1], dir, 2.6 + rnd(seed + 33) * 1.5, 2 + rnd(seed + 34), deck, deck + 3 + rnd(seed + 35) * 1.5, wall, TRIM);
  }
  if (!sydney && height > 20 && height < 95 && rnd(seed + 36) > 0.25) {
    const s = spot((rnd(seed + 37) > 0.5 ? 1 : -1) * span * 0.24, (rnd(seed + 38) - 0.5) * span * 0.3, 2.6);
    if (s) {
      const legs = srgb(0.2, 0.2, 0.21);
      const y = deck + 2.6 + rnd(seed + 39) * 2;
      for (const [u, v] of [[-1.1, -1.1], [1.1, -1.1], [1.1, 1.1], [-1.1, 1.1]]) b.box(s[0] + dir.x * u + perp.x * v, s[1] + dir.y * u + perp.y * v, dir, 0.09, 0.09, deck, y, legs, TRIM);
      b.tank(s[0], s[1], 1.75, y, y + 3.4, 1.1, TANK_WOOD, WOOD);
    }
  }
}

// ---- Manhattan ----

const NYC_COPPER = [srgb(0.2, 0.36, 0.3), srgb(0.24, 0.4, 0.34), srgb(0.28, 0.3, 0.32)];
const STEEL_LEGS = srgb(0.2, 0.2, 0.21);
const TANK_STAVES = [srgb(0.36, 0.27, 0.2), srgb(0.3, 0.22, 0.16), srgb(0.42, 0.32, 0.23)];

function ringArea(r: THREE.Vector2[]): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i], q = r[(i + 1) % r.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

function ringCentroid(r: THREE.Vector2[]): THREE.Vector2 {
  let cx = 0, cz = 0, a = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i], q = r[(i + 1) % r.length];
    const w = p.x * q.y - q.x * p.y;
    a += w;
    cx += (p.x + q.x) * w;
    cz += (p.y + q.y) * w;
  }
  return Math.abs(a) < 1e-6 ? r[0].clone() : new THREE.Vector2(cx / (3 * a), cz / (3 * a));
}

/** The long axis of a footprint and its extent along and across it. */
function orientedBox(r: THREE.Vector2[]) {
  let best = 0;
  let dir = new THREE.Vector2(1, 0);
  for (let i = 0; i < r.length; i++) {
    const e = new THREE.Vector2().subVectors(r[(i + 1) % r.length], r[i]);
    if (e.length() > best) { best = e.length(); dir = e.clone().normalize(); }
  }
  const perp = new THREE.Vector2(-dir.y, dir.x);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const p of r) {
    const u = p.x * dir.x + p.y * dir.y, v = p.x * perp.x + p.y * perp.y;
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
  }
  return { dir, perp, u0, u1, v0, v1 };
}

/** Walls round a footprint from y0 to y1; each faces away from a point just inside it. */
function wallsAround(b: Builder, ring: THREE.Vector2[], sgn: number, y0: number, y1: number, col: THREE.Color, surf: number) {
  const nor = outNormals(ring, sgn);
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    if (p.distanceTo(q) < 1e-3) continue;
    const inside = new THREE.Vector3((p.x + q.x) / 2 - nor[i].x * 30, (y0 + y1) / 2, (p.y + q.y) / 2 - nor[i].y * 30);
    b.quad(new THREE.Vector3(p.x, y0, p.y), new THREE.Vector3(q.x, y0, q.y), new THREE.Vector3(q.x, y1, q.y), new THREE.Vector3(p.x, y1, p.y), col, surf, inside);
  }
}

/** A flat roof deck over a footprint, facing up. */
function deckOver(b: Builder, ring: THREE.Vector2[], y: number, col: THREE.Color) {
  const c = ringCentroid(ring);
  const low = new THREE.Vector3(c.x, y - 50, c.y);
  for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(ring.map((p) => p.clone()), [])) {
    b.tri(new THREE.Vector3(ring[i].x, y, ring[i].y), new THREE.Vector3(ring[j].x, y, ring[j].y), new THREE.Vector3(ring[k].x, y, ring[k].y), col, TRIM, low);
  }
}

/** A pyramid (or lantern) over a footprint, roofed in tile courses like the Vienna roofs. */
function pyramidOver(b: Builder, ring: THREE.Vector2[], y: number, rise: number, col: THREE.Color) {
  const c = ringCentroid(ring);
  const apex = new THREE.Vector3(c.x, y + rise, c.y);
  const low = new THREE.Vector3(c.x, y - 50, c.y);
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    b.tri(new THREE.Vector3(p.x, y, p.y), new THREE.Vector3(q.x, y, q.y), apex, col, VROOF, low);
  }
}

/** A steel tank leg: a three-sided post (no top or bottom), cheap and thin enough to read as a frame. */
function leg(b: Builder, x: number, z: number, y0: number, y1: number) {
  const k = [[0.14, 0], [-0.07, 0.12], [-0.07, -0.12]];
  const c = new THREE.Vector3(x, (y0 + y1) / 2, z);
  for (let i = 0; i < 3; i++) {
    const [ax, az] = k[i], [bx, bz] = k[(i + 1) % 3];
    b.quad(new THREE.Vector3(x + ax, y0, z + az), new THREE.Vector3(x + bx, y0, z + bz), new THREE.Vector3(x + bx, y1, z + bz), new THREE.Vector3(x + ax, y1, z + az), STEEL_LEGS, TRIM, c);
  }
}

/**
 * What stands on a New York roof, big enough to break the roof line at 300 m: the stair and lift bulkhead and the
 * wooden water tank on its steel frame (every building over six floors needs one), a second pair on a big roof.
 */
function roofEquipment(b: Builder, ring: THREE.Vector2[], deck: number, seed: number, height: number, wall: THREE.Color, tanks: boolean) {
  const area = ringArea(ring);
  if (area < 150 || height < 14) return;
  const c = ringCentroid(ring);
  const { dir, perp } = orientedBox(ring);
  const span = Math.sqrt(area);
  const spot = (du: number, dv: number, clearance: number) => {
    const x = c.x + dir.x * du + perp.x * dv, z = c.y + dir.y * du + perp.y * dv;
    for (const [ax, az] of [[0, 0], [clearance, 0], [-clearance, 0], [0, clearance], [0, -clearance]]) {
      if (!pointInRing(ring, x + ax, z + az)) return null;
    }
    return [x, z] as const;
  };
  const stone = wall.clone().multiplyScalar(0.85);
  const nB = area > 900 ? 2 : 1;
  for (let k = 0; k < nB; k++) {
    const s = spot((rnd(seed + 31 + k) - 0.5) * span * 0.3 + (k ? span * 0.22 : 0), (rnd(seed + 32 + k) - 0.5) * span * 0.3, 4.5);
    if (!s) continue;
    const w = Math.min(4 + rnd(seed + 33) * 2.4, span * 0.25), d = Math.min(3 + rnd(seed + 34) * 1.6, span * 0.18);
    const h = 3.8 + rnd(seed + 35) * 2;
    b.box(s[0], s[1], dir, w, d, deck, deck + h, stone, TRIM);
  }
  if (!tanks || height < 20 || height > 110) return;
  const nT = area > 700 ? 2 : 1;
  for (let k = 0; k < nT; k++) {
    if (rnd(seed + 36 + k * 5) < 0.18) continue;
    const s = spot((k ? -1 : 1) * span * 0.26 * (0.8 + rnd(seed + 37)), (rnd(seed + 38 + k) - 0.5) * span * 0.34, 3.6);
    if (!s) continue;
    const r = 2.1 + rnd(seed + 39 + k) * 0.7;
    const y = deck + 3.2 + rnd(seed + 40 + k) * 1.6;
    for (const [u, v] of [[-1.4, -1.4], [1.4, -1.4], [1.4, 1.4], [-1.4, 1.4]]) leg(b, s[0] + dir.x * u + perp.x * v, s[1] + dir.y * u + perp.y * v, deck, y);
    b.tank(s[0], s[1], r, y, y + 4.4, 1.7, TANK_STAVES[Math.floor(rnd(seed + 41 + k) * 3)], WOOD);
  }
}

// towers: a character per tower, from its tags, size and a hash (aux of the CURTAIN surface tells the shader which)
const T_CURTAIN = 0, T_CONCRETE = 1, T_DARK = 2, T_SILVER = 3, T_BOX = 4;
const TOWER_TONE: Record<number, THREE.Color> = {
  [T_CONCRETE]: srgb(0.82, 0.8, 0.75), [T_DARK]: srgb(0.1, 0.13, 0.17), [T_SILVER]: srgb(0.62, 0.69, 0.72), [T_BOX]: srgb(0.2, 0.17, 0.15),
};

/**
 * A Manhattan block or one 3D part of it. Pre-war apartment houses: a different stone at the base under a moulding,
 * corner piers and shallow bays, a cornice that throws a shadow, setback terraces on tall plain blocks, copper
 * mansards, twin crown towers on the big houses, a water tank and a bulkhead you can see from the street.
 * Glass towers: a character each (pale concrete grid, dark glass, silvery glass with a stepped top, 1960s dark
 * box) and a crown. Parts carry their own shape: no setbacks added to them.
 */
function addManhattanBlock(bld: Building, b: Builder, heightAt: (x: number, z: number) => number, seed: number, ox: number, oz: number) {
  const ring = simplify(bld.ring);
  if (ring.length < 3) return;
  let gmin = Infinity, gmax = -Infinity;
  for (const p of ring) {
    const h = heightAt(p.x, p.y);
    if (!Number.isFinite(h)) return;
    gmin = Math.min(gmin, h);
    gmax = Math.max(gmax, h);
  }
  const height = Math.max(bld.height, 3.5);
  const top = gmax + height;
  const bottom = bld.minHeight !== undefined ? gmax + Math.min(bld.minHeight, height - 1) : gmin - 0.6;
  const local = ring.map((p) => new THREE.Vector2(p.x - ox, p.y - oz));
  let sa = 0;
  for (let i = 0; i < local.length; i++) {
    const p = local[i], q = local[(i + 1) % local.length];
    sa += p.x * q.y - q.x * p.y;
  }
  if (Math.abs(sa) < 2) return;
  const sgn = Math.sign(sa);
  const area = Math.abs(sa) / 2;
  const cen = ringCentroid(local);
  const mat = bld.material;
  const tallRule = height > 125 || ((bld.kind === 'office' || bld.kind === 'commercial') && height > 48 && rnd(seed + 2) > 0.45);
  const glass = mat === 'glass' || mat === 'metal' || mat === 'steel' || (!mat && !bld.wallColour && tallRule);
  const row = !bld.part && height < 21 && area < 420;
  const set = glass ? NYC_GLASS : row ? NYC_ROWHOUSE : NYC_MASONRY;
  const wall = parseColour(bld.wallColour, set[Math.floor(rnd(seed) * set.length)]).clone();
  const hsl = { h: 0, s: 0, l: 0 };

  // --- a character for glass towers
  let char = T_CURTAIN;
  if (glass && height > 60) {
    wall.getHSL(hsl);
    const r = rnd(seed + 60);
    if (bld.wallColour) {
      // parts of one tower share their tag: let the colour pick the character, so the stack stays one tower
      const l = hsl.l;
      char = l < 0.16 ? (height > 150 ? T_DARK : T_BOX) : l > 0.58 ? (height > 180 && area < 1500 ? T_CONCRETE : T_SILVER) : T_CURTAIN;
    } else if (height > 200 && area < 1600) char = r < 0.34 ? T_CONCRETE : r < 0.67 ? T_DARK : T_SILVER;
    else char = r < 0.26 ? T_SILVER : r < 0.5 ? T_DARK : r < 0.68 ? T_BOX : T_CURTAIN;
  }
  if (glass || !bld.wallColour) {
    // tagged colours are often pure black or white: keep them inside what stone, brick and glass can be
    wall.getHSL(hsl);
    const tone = TOWER_TONE[char];
    if (tone && !bld.wallColour) wall.copy(tone);
    else wall.setHSL(hsl.h, Math.min(hsl.s, 0.55), Math.min(Math.max(hsl.l, glass ? 0.02 : 0.05), 0.62));
  } else {
    // OSM wall colours on masonry are often garish (a lime-yellow block on Central Park West): pull the hue
    // towards brick and sandstone, keep only a loose memory of it, and cap saturation and lightness
    wall.getHSL(hsl, THREE.SRGBColorSpace);
    const dh = ((hsl.h - 0.07 + 1.5) % 1) - 0.5;
    const h = 0.07 + Math.max(-0.05, Math.min(0.05, dh * 0.4));
    wall.setHSL(h, Math.min(hsl.s * 0.8, 0.3), Math.min(Math.max(hsl.l, 0.3), 0.72), THREE.SRGBColorSpace);
  }
  const surf = glass ? CURTAIN : MASONRY;
  const pyramid = bld.roof === 'pyramidal';
  const rise = pyramid ? Math.min(bld.roofHeight ?? Math.min(Math.sqrt(area) * 0.6, 9), height - 1) : 0;
  const wallTop = top - rise;
  const roofCol = parseColour(bld.roofColour, NYC_ROOFS[Math.floor(rnd(seed + 7) * NYC_ROOFS.length)]);
  const span = Math.sqrt(area);

  // --- setbacks: a plan of tiers (fraction of the height where the tier ends, inset of the next one)
  const plan: [number, number][] = [];
  if (!bld.part && !pyramid && bld.minHeight === undefined) {
    if (!glass && height > 52 && area > 480 && rnd(seed + 50) < 0.55) {
      const s = Math.min(6, Math.max(2.6, span * 0.075));
      if (height > 110) plan.push([0.6, s], [0.8, s * 1.1]);
      else plan.push([0.76, s]);
    } else if (char === T_SILVER) {
      const s = Math.min(4, Math.max(1.8, span * 0.05));
      plan.push([0.86, s], [0.94, s]);
    } else if (char === T_DARK) plan.push([0.95, Math.min(7, Math.max(2.5, span * 0.12))]);
  }
  type Tier = { ring: THREE.Vector2[]; y0: number; y1: number };
  const tiers: Tier[] = [];
  let cur = local, yPrev = bottom;
  for (const [f, d] of plan) {
    const nxt = insetRing(cur, sgn, d);
    if (!nxt) break;
    const y1 = gmax + height * f;
    tiers.push({ ring: cur, y0: yPrev, y1 });
    yPrev = y1 - 0.9;
    cur = nxt;
  }
  tiers.push({ ring: cur, y0: yPrev, y1: wallTop });
  const multi = tiers.length > 1;
  const attic = (t: number) => (t > 0 ? -1 : 0);

  // --- base colour and heights (masonry): the stone base is a clearly different stone from the shaft
  const lum = wall.r * 0.3 + wall.g * 0.55 + wall.b * 0.15;
  const baseCol = lum > 0.28 ? wall.clone().lerp(srgb(0.45, 0.42, 0.38), 0.55) : wall.clone().lerp(srgb(0.82, 0.78, 0.7), 0.6);
  const stoneLight = wall.clone().lerp(srgb(0.86, 0.83, 0.76), 0.55).multiplyScalar(1.06);
  const stoneShade = stoneLight.clone().multiplyScalar(0.55);
  const baseH = height > 75 ? 10.5 : height > 35 ? 7.4 : 5.2;
  const dressed = !glass && !pyramid && height > 14 && bottom < gmax + 1;
  const cs = height > 60 ? 1.9 : height > 30 ? 1.5 : 1.1;

  tiers.forEach((t, k) => {
    b.setBase(gmax, t.y1);
    const split = dressed && k === 0 && t.y1 - gmax > 25;
    b.setAux(glass ? char : split ? baseH : attic(k));
    if (split) {
      wallsAround(b, t.ring, sgn, t.y0, gmax + baseH, baseCol, surf);
      wallsAround(b, t.ring, sgn, gmax + baseH, t.y1, wall, surf);
    } else wallsAround(b, t.ring, sgn, t.y0, t.y1, wall, surf);
    b.setAux(0);
    if (!glass && !pyramid && t.y1 - gmax > 12) {
      if (split && t.ring.length < 18) ledge(b, t.ring, sgn, gmax + baseH - 0.3, 0.6, 0.42, stoneLight, stoneShade, 5, true);
      if (t.y1 - gmax > 35 && t.ring.length < 14) {
        const pt = t.y1 - 0.3 - 1.25 * cs;
        const y0 = k === 0 ? gmax + (split ? baseH : 0) : t.y0;
        if (pt - y0 > 6) {
          quoins(b, t.ring, sgn, y0, pt, 0.34, 1.5, stoneLight, TRIM, 7);
          // shallow bays on the longest fronts: a wall that is not one plane
          if (t.y1 - gmax > 32 && k === 0) {
            const order = t.ring.map((_, i) => i).sort((a, c) => t.ring[(c + 1) % t.ring.length].distanceTo(t.ring[c]) - t.ring[(a + 1) % t.ring.length].distanceTo(t.ring[a])).slice(0, 2);
            for (const i of order) {
              const len = t.ring[i].distanceTo(t.ring[(i + 1) % t.ring.length]);
              if (len < 26 || rnd(seed + 55 + i) < 0.25) continue;
              const w = Math.min(len * 0.34, 14);
              b.setBase(gmax, t.y1);
              b.setAux(-1);
              projection(b, t.ring, sgn, i, (len - w) / 2, (len + w) / 2, 0.6, gmax + (split ? baseH : 0), pt, wall, surf);
              b.setAux(0);
            }
          }
        }
      }
      cornice(b, t.ring, sgn, t.y1, wall, cs);
    }
    // terrace of a setback: a deck between this tier's walls and the next tier's, parapet standing round it
    if (k < tiers.length - 1) deckOver(b, t.ring, t.y1 - 0.9, roofCol);
  });

  const last = tiers[tiers.length - 1];
  const roofCentre = new THREE.Vector3(cen.x, wallTop - 50, cen.y);
  if (pyramid) {
    // copper-green or slate caps of the pre-war towers (the Pierre, the Sherry-Netherland, the San Remo lanterns)
    const cap = parseColour(bld.roofColour, rnd(seed + 4) > 0.5 ? COPPER : srgb(0.3, 0.31, 0.33));
    const apex = new THREE.Vector3(cen.x, top, cen.y);
    for (let i = 0; i < local.length; i++) {
      const p = local[i], q = local[(i + 1) % local.length];
      b.tri(new THREE.Vector3(p.x, wallTop, p.y), new THREE.Vector3(q.x, wallTop, q.y), apex, cap, TRIM, roofCentre);
    }
    return;
  }
  // the walls stand a parapet's height above the roof deck
  const deck = wallTop - (height > 8 && ringArea(last.ring) > 60 ? 0.9 : 0.15);

  // a few copper mansards on plain pre-war blocks: a green roof is what the eye finds at 300 m
  let mansard = false;
  if (!glass && !bld.part && !multi && height > 28 && height < 115 && area > 220 && rnd(seed + 65) < 0.16) {
    const d1 = Math.min(2.6, span * 0.08), dy1 = 4.4;
    const r1 = insetRing(local, sgn, d1);
    const r2 = r1 ? insetRing(r1, sgn, Math.min(2.2, span * 0.06)) : null;
    if (r1 && r2) {
      const col = NYC_COPPER[Math.floor(rnd(seed + 66) * NYC_COPPER.length)];
      b.setBase(gmax, wallTop);
      const lowC = new THREE.Vector3(cen.x, wallTop - 50, cen.y);
      for (let i = 0; i < local.length; i++) {
        const j = (i + 1) % local.length;
        const V = (p: THREE.Vector2, y: number) => new THREE.Vector3(p.x, y, p.y);
        b.quad(V(local[i], wallTop), V(local[j], wallTop), V(r1[j], wallTop + dy1), V(r1[i], wallTop + dy1), col, VROOF, lowC);
        b.quad(V(r1[i], wallTop + dy1), V(r1[j], wallTop + dy1), V(r2[j], wallTop + dy1 + 1.1), V(r2[i], wallTop + dy1 + 1.1), col, VROOF, lowC);
      }
      deckOver(b, r2, wallTop + dy1 + 1.1, roofCol);
      dormersOn(b, local, sgn, wallTop, dy1, d1, col, seed);
      mansard = true;
      roofEquipment(b, r2, wallTop + dy1 + 1.1, seed, height, wall, false);
    }
  }
  if (!mansard) {
    deckOver(b, last.ring, deck, roofCol);
    b.setBase(gmax, wallTop);
    // crowns: what makes a tower a particular tower
    if (glass && height > 60) crown(b, last.ring, sgn, deck, wallTop, height, char, seed, wall, bld.part !== undefined);
    else if (!bld.part && multi && !glass) {
      // an older stone setback tower ends in a lantern and a pyramid, copper or slate
      const lantern = NYC_COPPER[Math.floor(rnd(seed + 67) * NYC_COPPER.length)];
      const inner = insetRing(last.ring, sgn, Math.min(2.2, Math.sqrt(ringArea(last.ring)) * 0.14));
      if (inner && ringArea(inner) > 20) {
        wallsAround(b, inner, sgn, wallTop - 0.9, wallTop + 3.4, stoneLight, TRIM);
        pyramidOver(b, inner, wallTop + 3.4, Math.min(height * 0.07, 16), lantern);
      } else roofEquipment(b, last.ring, deck, seed, height, wall, true);
    } else if (!bld.part && !glass) {
      roofEquipment(b, last.ring, deck, seed, height, wall, true);
      twinTowers(b, local, sgn, deck, gmax, height, area, seed, wall, bld.kind);
    } else if (!glass) roofEquipment(b, last.ring, deck, seed, height, wall, false);
  }
}

/** A mansard's dormers: small windows under gables in the steep copper slope. */
function dormersOn(b: Builder, ring: THREE.Vector2[], sgn: number, y0: number, dy: number, d: number, col: THREE.Color, seed: number) {
  const n = ring.length;
  const nor = outNormals(ring, sgn);
  let count = 0;
  const glassC = srgb(0.05, 0.06, 0.08), frame = srgb(0.84, 0.82, 0.76);
  for (let i = 0; i < n && count < 18; i++) {
    const p = ring[i], q = ring[(i + 1) % n];
    const e = new THREE.Vector2().subVectors(q, p);
    const len = e.length();
    if (len < 8) continue;
    e.divideScalar(len);
    const ni = nor[i].clone().multiplyScalar(-1);
    const m = Math.max(1, Math.floor((len - 5) / 5.2));
    for (let k = 0; k < m && count < 18; k++) {
      const t = 2.5 + ((len - 5) / m) * (k + 0.5);
      const hw = 0.7, sf = d * 0.34, yb = y0 + dy * 0.34, yt = yb + 1.4, ya = yt + 0.55;
      const C = p.clone().addScaledVector(e, t);
      const P = (s: number, a: number, y: number) => new THREE.Vector3(C.x + ni.x * s + e.x * a, y, C.y + ni.y * s + e.y * a);
      const behind = P(sf + 3, 0, yb + 0.6);
      b.quad(P(sf, -hw, yb), P(sf, hw, yb), P(sf, hw, yt), P(sf, -hw, yt), frame, TRIM, behind);
      b.quad(P(sf - 0.04, -hw * 0.6, yb + 0.2), P(sf - 0.04, hw * 0.6, yb + 0.2), P(sf - 0.04, hw * 0.6, yt - 0.2), P(sf - 0.04, -hw * 0.6, yt - 0.2), glassC, TRIM, behind);
      b.tri(P(sf, -hw, yt), P(sf, hw, yt), P(sf, 0, ya), frame, TRIM, behind);
      const below = P(sf + 1, 0, yb - 2);
      b.quad(P(sf, -hw, yt), P(sf, 0, ya), P(d * 0.8, 0, ya), P(d * 0.7, -hw, yt), col, TRIM, below);
      b.quad(P(sf, hw, yt), P(sf, 0, ya), P(d * 0.8, 0, ya), P(d * 0.7, hw, yt), col, TRIM, below);
      count++;
    }
  }
  void seed;
}

/** Tower crowns: each character ends differently so a skyline is not a row of identical prisms. */
function crown(
  b: Builder, ring: THREE.Vector2[], sgn: number, deck: number, wallTop: number, height: number, char: number, seed: number, wall: THREE.Color, part: boolean,
) {
  const area = ringArea(ring);
  const c = ringCentroid(ring);
  const { dir } = orientedBox(ring);
  const dark = wall.clone().multiplyScalar(0.55);
  const span = Math.sqrt(area);
  if (char === T_BOX || char === T_CURTAIN) {
    // a big mechanical penthouse and a few small boxes: the 1960s and 70s slab roof
    b.box(c.x, c.y, dir, span * 0.22, span * 0.17, deck, deck + 4.5 + rnd(seed + 71) * 2, dark, TRIM);
    if (area > 300) b.box(c.x + span * 0.2, c.y - span * 0.12, dir, 2.2, 1.8, deck, deck + 2.4, STEEL_LEGS, TRIM);
  } else if (char === T_CONCRETE) {
    // 432 Park: a plain flat top with a low service floor
    b.box(c.x, c.y, dir, span * 0.2, span * 0.2, deck, deck + 2.2, dark, TRIM);
  } else if (char === T_DARK) {
    b.box(c.x, c.y, dir, span * 0.16, span * 0.16, deck, deck + 5, dark, TRIM);
  } else if (char === T_SILVER) {
    // stepped top: the last tier carries a lit cap and an antenna mast
    b.box(c.x, c.y, dir, span * 0.14, span * 0.14, deck, deck + 3.5, dark, TRIM);
  }
  if (height > 190 && (!part || rnd(seed + 72) < 0.5)) {
    // an antenna mast: a thin spike that shows against the sky from kilometres away
    const m = Math.min(22, height * 0.07);
    const w = 0.5;
    const apex = new THREE.Vector3(c.x, deck + m, c.y);
    const base = [[-w, -w], [w, -w], [w, w], [-w, w]].map(([x, z]) => new THREE.Vector3(c.x + x, deck, c.y + z));
    for (let i = 0; i < 4; i++) b.tri(base[i], base[(i + 1) % 4], apex, STEEL_LEGS, TRIM, new THREE.Vector3(c.x, deck - 50, c.y));
  }
  void wallTop; void sgn;
}

/**
 * The twin towers of the big pre-war houses on Central Park West and Fifth Avenue (San Remo, Eldorado, Majestic,
 * Century): two stepped towers with copper or slate caps rising from the roof, near the ends of the long axis.
 */
function twinTowers(
  b: Builder, ring: THREE.Vector2[], sgn: number, deck: number, gmax: number, height: number, area: number, seed: number, wall: THREE.Color, kind: string,
) {
  if (height < 62 || height > 160 || area < 650) return;
  if (!['apartments', 'yes', 'residential', 'hotel', 'house'].includes(kind) || rnd(seed + 70) > 0.6) return;
  const { dir, perp, u0, u1, v0, v1 } = orientedBox(ring);
  const L = u1 - u0, W = v1 - v0;
  if (W < 14 || L < 30) return;
  const side = Math.min(13, Math.max(7, W * 0.38));
  const extra = Math.min(26, Math.max(13, height * 0.2));
  const vm = (v0 + v1) / 2;
  const cap = NYC_COPPER[Math.floor(rnd(seed + 73) * 3)];
  const stone = wall.clone().lerp(srgb(0.86, 0.83, 0.76), 0.35);
  for (const u of [u0 + side / 2 + L * 0.14, u1 - side / 2 - L * 0.14]) {
    const P = (uu: number, vv: number) => new THREE.Vector2(dir.x * uu + perp.x * vv, dir.y * uu + perp.y * vv);
    let ok = true;
    for (const [a, c] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const q = P(u + a * side / 2, vm + c * side / 2);
      if (!pointInRing(ring, q.x, q.y)) ok = false;
    }
    if (!ok) continue;
    const rect = (hs: number) => [P(u - hs, vm - hs), P(u + hs, vm - hs), P(u + hs, vm + hs), P(u - hs, vm + hs)];
    const r0 = rect(side / 2), r1 = rect(side * 0.36);
    const yA = deck - 0.9, yB = deck + extra * 0.62, yC = yB + extra * 0.2;
    b.setBase(deck, yB);
    b.setAux(-1);
    wallsAround(b, r0, 1, yA, yB, wall, MASONRY);
    b.setBase(deck, yC);
    wallsAround(b, r1, 1, yB - 0.9, yC, wall, MASONRY);
    b.setAux(0);
    cornice(b, r0, 1, yB, wall, 1.2);
    deckOver(b, r0, yB - 0.9, NYC_ROOFS[0]);
    cornice(b, r1, 1, yC, wall, 1.0);
    b.setBase(deck, yC + extra * 0.4);
    pyramidOver(b, r1, yC, extra * 0.34, cap);
    // a lantern of stone under the finial
    wallsAround(b, rect(0.45), 1, yC + extra * 0.34 - 0.2, yC + extra * 0.34 + 1.2, stone, TRIM);
    void gmax; void sgn;
  }
}

/**
 * The projecting stone cornice of a pre-war apartment house: a ledge about half a metre out and a metre tall just
 * under the parapet, with a thin fillet below it. The outline is offset with mitred corners; every face gets its
 * own inside point so the lighting normals come out right (the soffit must face down, the top up).
 */
export function cornice(b: Builder, ring: THREE.Vector2[], sgn: number, wallTop: number, wall: THREE.Color, scale = 1) {
  const n = ring.length;
  const out = (i: number) => {
    const e = new THREE.Vector2().subVectors(ring[(i + 1) % n], ring[i]).normalize();
    return new THREE.Vector2(e.y * sgn, -e.x * sgn);
  };
  const stone = wall.clone().lerp(srgb(0.8, 0.77, 0.7), 0.55).multiplyScalar(1.08);
  const shade = stone.clone().multiplyScalar(scale > 1 ? 0.62 : 0.8);
  const offs = (d: number) => ring.map((p, i) => {
    const n0 = out((i - 1 + n) % n), n1 = out(i);
    const m = new THREE.Vector2().addVectors(n0, n1).multiplyScalar(d / Math.max(1 + n0.dot(n1), 0.35));
    return p.clone().add(m);
  });
  const big = offs(0.55 * scale), small = offs(0.25 * scale);
  const yTop = wallTop - 0.3, yMid = yTop - 0.9 * scale, yLow = yMid - 0.35 * scale;
  const V = (p: THREE.Vector2, y: number) => new THREE.Vector3(p.x, y, p.y);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    // chamfered and curved corners are runs of tiny edges: a ledge round each one cost more than the walls
    if (ring[i].distanceTo(ring[j]) < 1.6) continue;
    const o = out(i);
    const mid = (a: THREE.Vector2[], y: number) => new THREE.Vector3((a[i].x + a[j].x) / 2, y, (a[i].y + a[j].y) / 2);
    const inside = (a: THREE.Vector2[], y: number) => mid(a, y).addScaledVector(new THREE.Vector3(o.x, 0, o.y), -50);
    // main ledge: top, face, soffit
    b.quad(V(ring[i], yTop), V(ring[j], yTop), V(big[j], yTop), V(big[i], yTop), stone, TRIM, mid(big, yTop - 50));
    b.quad(V(big[i], yMid), V(big[j], yMid), V(big[j], yTop), V(big[i], yTop), stone, TRIM, inside(big, (yMid + yTop) / 2));
    b.quad(V(ring[i], yMid), V(ring[j], yMid), V(big[j], yMid), V(big[i], yMid), shade, TRIM, mid(big, yMid + 50));
    if (scale < 1.3) continue;
    // fillet under it (tall houses only: on a row house it is a few pixels)
    b.quad(V(small[i], yLow), V(small[j], yLow), V(small[j], yMid), V(small[i], yMid), shade, TRIM, inside(small, (yLow + yMid) / 2));
    b.quad(V(ring[i], yLow), V(ring[j], yLow), V(small[j], yLow), V(small[i], yLow), shade, TRIM, mid(small, yLow + 50));
  }
}

/** Hip roof over any simple footprint by insetting it; false (draw it flat) when the inset folds over. */
function hipRoof(b: Builder, ring: THREE.Vector2[], eave: number, pitch: number, col: THREE.Color, centre: THREE.Vector3): boolean {
  const n = ring.length;
  let area = 0, perim = 0;
  for (let i = 0; i < n; i++) {
    const p = ring[i], q = ring[(i + 1) % n];
    area += p.x * q.y - q.x * p.y;
    perim += p.distanceTo(q);
  }
  const sgn = Math.sign(area);
  // inset ~3/4 of the half width (area / perimeter ≈ half the width of a long block), at most 4.5 m
  const d = Math.min(4.5, (0.75 * Math.abs(area / 2)) / perim);
  if (d < 1) return false;
  const normal = (i: number) => {
    const e = new THREE.Vector2().subVectors(ring[(i + 1) % n], ring[i]).normalize();
    return new THREE.Vector2(-e.y * sgn, e.x * sgn);
  };
  const inner = ring.map((p, i) => {
    const n0 = normal((i - 1 + n) % n), n1 = normal(i);
    const k = 1 + n0.dot(n1);
    const m = new THREE.Vector2().addVectors(n0, n1).multiplyScalar(d / Math.max(k, 0.22));
    return p.clone().add(m);
  });
  let ia = 0;
  for (let i = 0; i < n; i++) ia += inner[i].x * inner[(i + 1) % n].y - inner[(i + 1) % n].x * inner[i].y;
  if (Math.sign(ia) !== sgn || Math.abs(ia) < Math.abs(area) * 0.08) return false;
  const top = eave + d * Math.tan(pitch);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    b.quad(
      new THREE.Vector3(ring[i].x, eave, ring[i].y), new THREE.Vector3(ring[j].x, eave, ring[j].y),
      new THREE.Vector3(inner[j].x, top, inner[j].y), new THREE.Vector3(inner[i].x, top, inner[i].y), col, ROOF, centre,
    );
  }
  for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(inner, [])) {
    b.tri(new THREE.Vector3(inner[i].x, top, inner[i].y), new THREE.Vector3(inner[j].x, top, inner[j].y), new THREE.Vector3(inner[k].x, top, inner[k].y), col, ROOF, centre);
  }
  return true;
}


// ---- Sydney's eastern suburbs ----
// Red-brown and cream brick, terracotta tile roofs; 1960s walk-up flats in red and blond brick; Art Deco render.
const SYD_BRICKS = [srgb(0.55, 0.26, 0.19), srgb(0.62, 0.33, 0.22), srgb(0.5, 0.25, 0.2), srgb(0.66, 0.4, 0.27), srgb(0.46, 0.22, 0.17)];
const SYD_BLOND = [srgb(0.78, 0.64, 0.43), srgb(0.84, 0.72, 0.52), srgb(0.72, 0.56, 0.38)];
const SYD_RENDERS = [srgb(0.93, 0.9, 0.83), srgb(0.9, 0.84, 0.7), srgb(0.84, 0.89, 0.85), srgb(0.9, 0.78, 0.7), srgb(0.96, 0.95, 0.92), srgb(0.88, 0.85, 0.78)];
const SYD_TILES = [srgb(0.52, 0.27, 0.2), srgb(0.46, 0.24, 0.18), srgb(0.58, 0.32, 0.23), srgb(0.42, 0.22, 0.17), srgb(0.36, 0.34, 0.33)];
// Bondi Junction's towers: grey-green and bronze glass, pale concrete
const SYD_GLASS = [srgb(0.42, 0.52, 0.55), srgb(0.55, 0.6, 0.58), srgb(0.66, 0.67, 0.64), srgb(0.33, 0.4, 0.43), srgb(0.5, 0.48, 0.42)];
const SYD_FLAT_ROOFS = [srgb(0.45, 0.45, 0.44), srgb(0.55, 0.54, 0.51), srgb(0.38, 0.4, 0.4)];

/**
 * One Sydney building. Towers and 3D parts reuse the city block code (glass and concrete, no New York water tanks);
 * houses get hipped or gabled terracotta roofs with a chimney; walk-up flats and shops are flat-roofed (a third
 * with a low hip) with parapets. Surface ids carry the look to the shader: brick wall, render, flats with balconies.
 */
function addSydneyBuilding(bld: Building, b: Builder, heightAt: (x: number, z: number) => number, seed: number, ox: number, oz: number) {
  if (bld.part || bld.height >= 24) return addCityBlock(bld, b, heightAt, seed, ox, oz, true);
  const ring = simplify(bld.ring);
  if (ring.length < 3) return;
  let gmin = Infinity, gmax = -Infinity;
  for (const p of ring) {
    const h = heightAt(p.x, p.y);
    if (!Number.isFinite(h)) return;
    gmin = Math.min(gmin, h);
    gmax = Math.max(gmax, h);
  }
  const base = gmin - 0.6;
  const local = ring.map((p) => new THREE.Vector2(p.x - ox, p.y - oz));
  let area = 0;
  for (let i = 0; i < local.length; i++) {
    const p = local[i], q = local[(i + 1) % local.length];
    area += p.x * q.y - q.x * p.y;
  }
  area = Math.abs(area) / 2;
  const kind = bld.kind;
  const centre0 = new THREE.Vector3(local.reduce((s, p) => s + p.x, 0) / local.length, 0, local.reduce((s, p) => s + p.y, 0) / local.length);
  // an open roof (bus shelter, carport, petrol canopy): a slab on its own, no walls
  if (kind === 'roof' || kind === 'carport') {
    const y = gmax + 2.9;
    b.setBase(gmax, y);
    const c = new THREE.Vector3(centre0.x, y - 50, centre0.z);
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(local, [])) {
      b.tri(new THREE.Vector3(local[i].x, y, local[i].y), new THREE.Vector3(local[j].x, y, local[j].y), new THREE.Vector3(local[k].x, y, local[k].y), srgb(0.7, 0.7, 0.68), TRIM, c);
    }
    return;
  }
  const shopKind = ['commercial', 'retail', 'pub', 'office', 'hotel'].includes(kind);
  const instit = ['university', 'school', 'hospital', 'public', 'government', 'civic', 'kindergarten', 'dormitory', 'military', 'synagogue', 'church', 'grandstand', 'service', 'construction'].includes(kind);
  const levels = bld.levels ?? Math.max(1, Math.round((bld.height - 1) / 3));
  const flats = !instit && !shopKind && (kind === 'apartments' || (levels >= 3 && area > 120) || (['residential', 'yes'].includes(kind) && area > 260 && levels >= 2));
  // houses: everything small and low that is not a shop, school or block of flats
  const house = !flats && !shopKind && !instit && area < 420;
  const storeyH = flats || shopKind || instit ? 3.0 : 3.1;
  const wallTop = gmax + Math.max(2.9, (house ? Math.min(levels, 2) : levels) * storeyH + 0.2);
  b.setBase(gmax, wallTop);
  const centre = new THREE.Vector3(centre0.x, (base + wallTop) / 2, centre0.z);
  // colours: houses red-brown brick (a quarter cream render), flats red or blond brick or pastel Art Deco render,
  // shops and institutions render or blond brick
  const pick = <T,>(a: T[], k: number) => a[Math.floor(rnd(seed + k) * a.length)];
  let wallCol: THREE.Color, surf: number;
  if (house) { const render = rnd(seed + 1) < 0.28; wallCol = render ? pick(SYD_RENDERS, 2) : pick(SYD_BRICKS, 2); surf = render ? SYD_RENDER : SYD_BRICK; }
  else if (flats) { const m = rnd(seed + 1); if (m < 0.38) { wallCol = pick(SYD_BRICKS, 2); surf = SYD_FLATS; } else if (m < 0.62) { wallCol = pick(SYD_BLOND, 2); surf = SYD_FLATS; } else { wallCol = pick(SYD_RENDERS, 2); surf = SYD_RENDER; } }
  else { const m = rnd(seed + 1); if (m < 0.5) { wallCol = pick(SYD_RENDERS, 2); surf = SYD_RENDER; } else { wallCol = pick(SYD_BLOND, 2); surf = SYD_RENDER; } }
  const wall = parseColour(bld.wallColour, wallCol).clone();
  if (bld.wallColour) {
    // OSM colours are loose: keep them warm and inside what brick and render can be
    const hsl = { h: 0, s: 0, l: 0 };
    wall.getHSL(hsl, THREE.SRGBColorSpace);
    wall.setHSL(hsl.h, Math.min(hsl.s, 0.45), Math.min(Math.max(hsl.l, 0.25), 0.82), THREE.SRGBColorSpace);
  }
  // shops get awnings and glass in the ground floor (the 15.3 surface), and only where the block is on a street
  const wallSurf = surf === SYD_RENDER && shopKind ? SYD_RENDER + 0.3 : surf;
  for (let i = 0; i < local.length; i++) {
    const p = local[i], q = local[(i + 1) % local.length];
    b.quad(new THREE.Vector3(p.x, base, p.y), new THREE.Vector3(q.x, base, q.y), new THREE.Vector3(q.x, wallTop, q.y), new THREE.Vector3(p.x, wallTop, p.y), wall, wallSurf, centre);
  }

  // oriented bounding rectangle along the longest edge
  let best = 0;
  let dir = new THREE.Vector2(1, 0);
  for (let i = 0; i < local.length; i++) {
    const e = new THREE.Vector2().subVectors(local[(i + 1) % local.length], local[i]);
    if (e.length() > best) { best = e.length(); dir = e.clone().normalize(); }
  }
  const perp = new THREE.Vector2(-dir.y, dir.x);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const p of local) {
    const u = p.x * dir.x + p.y * dir.y, v = p.x * perp.x + p.y * perp.y;
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
  }
  const rectish = area / ((u1 - u0) * (v1 - v0)) > 0.78 && v1 - v0 < 30;
  const roofCentre = new THREE.Vector3(centre.x, wallTop - 50, centre.z);
  const tile = parseColour(bld.roofColour, pick(SYD_TILES, 7));
  const lowHip = !house && rnd(seed + 8) < 0.3 && !shopKind;
  if ((house || instit) && rectish) {
    const P = (u: number, v: number, y: number) => new THREE.Vector3(dir.x * u + perp.x * v, y, dir.y * u + perp.y * v);
    const half = (v1 - v0) / 2, vm = (v0 + v1) / 2;
    const pitch = THREE.MathUtils.degToRad(house ? 24 + rnd(seed + 11) * 8 : 18);
    const rise = Math.min(half * Math.tan(pitch), 4.8);
    const ov = 0.55;
    const eave = wallTop - ov * (rise / half);
    const ridgeY = wallTop + rise;
    // Californian bungalows are gabled to the street, Federation houses hipped; long thin terraces are gabled
    const hipped = rnd(seed + 12) < 0.7 && (u1 - u0) < (v1 - v0) * 2.6;
    const hip = hipped ? Math.min(half, (u1 - u0) / 2 - 0.3) : 0;
    const rA = P(u0 - ov + hip, vm, ridgeY), rB = P(u1 + ov - hip, vm, ridgeY);
    const e00 = P(u0 - ov, v0 - ov, eave), e10 = P(u1 + ov, v0 - ov, eave), e01 = P(u0 - ov, v1 + ov, eave), e11 = P(u1 + ov, v1 + ov, eave);
    b.quad(e00, e10, rB, rA, tile, ROOF, roofCentre);
    b.quad(e01, e11, rB, rA, tile, ROOF, roofCentre);
    if (hipped) {
      b.tri(e00, e01, rA, tile, ROOF, roofCentre);
      b.tri(e10, e11, rB, tile, ROOF, roofCentre);
    } else {
      for (const u of [u0, u1]) b.tri(P(u, v0, wallTop), P(u, v1, wallTop), P(u, vm, ridgeY), wall, surf === SYD_RENDER ? SYD_RENDER : SYD_BRICK, centre);
    }
    // the brick chimney of a Federation house, on the ridge a third of the way along
    if (house && (u1 - u0) > 6 && rnd(seed + 14) < 0.7) {
      const cu = u0 + (u1 - u0) * (0.28 + 0.4 * rnd(seed + 15));
      b.box(dir.x * cu + perp.x * vm, dir.y * cu + perp.y * vm, dir, 0.4, 0.4, wallTop, ridgeY + 1.1, pick(SYD_BRICKS, 16), TRIM);
    }
    return;
  }
  // odd footprints: a hip over the whole outline when it will fold, otherwise flat
  if (house || lowHip) {
    if (hipRoof(b, local, wallTop, THREE.MathUtils.degToRad(house ? 22 : 12), house ? tile : pick(SYD_FLAT_ROOFS, 9), roofCentre)) return;
  }
  // flat roof with a parapet (flats, shops, schools)
  const par = 0.55;
  for (let i = 0; i < local.length; i++) {
    const p = local[i], q = local[(i + 1) % local.length];
    b.quad(new THREE.Vector3(p.x, wallTop, p.y), new THREE.Vector3(q.x, wallTop, q.y), new THREE.Vector3(q.x, wallTop + par, q.y), new THREE.Vector3(p.x, wallTop + par, p.y), wall, TRIM, centre);
  }
  const deck = pick(SYD_FLAT_ROOFS, 9);
  for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(local, [])) {
    b.tri(new THREE.Vector3(local[i].x, wallTop + 0.1, local[i].y), new THREE.Vector3(local[j].x, wallTop + 0.1, local[j].y), new THREE.Vector3(local[k].x, wallTop + 0.1, local[k].y), deck, TRIM, roofCentre);
  }
  // a stair and lift housing on bigger blocks, a few clothes lines' worth of clutter is beyond us
  if (area > 220 && levels >= 3 && rectish) {
    const cu = (u0 + u1) / 2 + (rnd(seed + 20) - 0.5) * (u1 - u0) * 0.4, cv = (v0 + v1) / 2;
    b.box(dir.x * cu + perp.x * cv, dir.y * cu + perp.y * cv, dir, 1.8, 1.5, wallTop, wallTop + 2.7, wall, TRIM);
  }
}


/**
 * Fragment code for the Sydney surfaces (14 brick cottage, 15 render / shops, 16 brick flats with balconies), spliced
 * into the facade shader. Measures along the wall from its normal like the city surfaces; windows smaller than a
 * pixel fade to the mean of wall and glass.
 */
const SYDNEY_GLSL = /* glsl */ `
    float uc = dot(wp.xz, vec2(-n.z, n.x)) / max(length(n.xz), 0.001);
    float bid = fHash(floor(vec2(vBaseY * 7.31, vTopY * 3.17)));
    float total = vTopY - vBaseY;
    vec3 v = normalize(wp - cameraPosition);
    vec3 r = reflect(v, n);
    vec3 sky = atmoSky(normalize(vec3(r.x, abs(r.y) * 0.6 + 0.05, r.z)));
    float fres = pow(max(1.0 - abs(dot(-v, n)), 0.0), 3.0);
    float shop = step(abs(vSurf - 15.3), 0.05);
    float fh = 3.0 + 0.15 * bid;
    float inWall = step(hy, total + 0.2) * step(0.0, hy);
    float near = 1.0 - smoothstep(25.0, 90.0, camD);
    vec3 base = diffuseColor.rgb;
    base *= 0.94 + 0.12 * fHash(floor(vec2(uc / 3.5, hy / 2.5)) + bid);
    if (sid != 15) {
      // brick: stretcher courses with a running bond, only from close by
      float brick = fHash(floor(vec2(uc / 0.23 + 0.5 * floor(hy / 0.075), hy / 0.075)));
      float course = smoothstep(0.0, 0.2, fract(hy / 0.075));
      base *= 1.0 + (brick - 0.5) * 0.22 * near;
      base *= 1.0 - 0.1 * near * (1.0 - course);
    }
    float bay = sid == 14 ? 3.3 + 1.3 * bid : sid == 16 ? 5.0 + 1.6 * bid : 2.3 + 0.9 * bid;
    float fx = fract(uc / bay);
    float seg = floor(uc / bay);
    float fy = fract(hy / fh);
    float gy = hy / fh;
    float fine = wallF * (1.0 - smoothstep(0.22, 0.6, max(fwidth(uc) / bay, fwidth(hy) / fh)));
    vec3 pane = mix(vec3(0.1, 0.12, 0.14), sky * 0.9, 0.3 + 0.5 * fres);
    // plinth and soot under the eaves
    base *= 1.0 - 0.18 * (1.0 - step(0.45, hy)) - 0.16 * smoothstep(0.7, 0.0, total - hy) * step(hy, total + 0.1);
    vec3 col = base;
    float k = fine * inWall;
    if (sid == 14) {
      // cottage: pairs of tall double-hung windows in white frames, a timber front door in one bay
      float ww = 0.17;
      float inX = step(0.5 - ww, fx) * step(fx, 0.5 + ww);
      float wy = step(0.3, fy) * step(fy, 0.8);
      float win = inX * wy * step(0.5, hy);
      float frame = win * (1.0 - step(0.5 - ww + 0.03, fx) * step(fx, 0.5 + ww - 0.03) * step(0.33, fy) * step(fy, 0.77));
      float sash = win * step(abs(fy - 0.55), 0.012);
      float door = step(0.82, fHash(vec2(seg, bid * 9.0))) * step(0.34, fx) * step(fx, 0.66) * step(hy, 2.15) * step(hy, fh) * step(0.0, hy);
      vec3 doorCol = fHash(vec2(bid, 3.0)) > 0.5 ? vec3(0.1, 0.22, 0.14) : vec3(0.3, 0.07, 0.07);
      float lintel = inX * step(0.8, fy) * step(fy, 0.84) * step(0.5, hy);
      col = mix(col, pane, win * (1.0 - door) * k);
      col = mix(col, vec3(0.9, 0.88, 0.82), max(frame, sash) * (1.0 - door) * k);
      col = mix(col, vec3(0.74, 0.7, 0.62), lintel * k * 0.8);
      col = mix(col, doorCol, door * k);
    } else if (sid == 15) {
      // rendered Art Deco block or shop terrace: pale floor bands, ribbon windows in steel frames, a stepped parapet
      float floorLine = abs(hy - fh * floor(hy / fh + 0.5));
      float band = step(floorLine, 0.14) * step(fh * 0.9, hy);
      float ww = 0.36;
      float inX = step(0.5 - ww, fx) * step(fx, 0.5 + ww);
      float up = step(fh * 1.15, hy) * step(hy, total - 0.8);
      float win = inX * step(0.3, fy) * step(fy, 0.82) * up;
      float mull = win * step(abs(fx - 0.5), 0.035);
      col = mix(col, vec3(0.93, 0.91, 0.86), band * k * 0.8);
      col = mix(col, pane, win * k);
      col = mix(col, vec3(0.9, 0.9, 0.88), mull * k);
      col = mix(col, vec3(0.93, 0.91, 0.86), step(total - hy, 0.7) * k * 0.7);
      // ground floor
      float gF = 1.0 - step(fh * 1.15, hy);
      float shopW = 3.6 + 1.2 * bid;
      float sseg = floor(uc / shopW);
      float sf = fract(uc / shopW);
      float sh = fHash(vec2(sseg, bid * 13.0));
      float glassF = shop * step(0.06, sf) * step(sf, 0.94) * step(0.2, hy) * step(hy, fh * 0.72);
      vec3 shopGlass = mix(vec3(0.05, 0.045, 0.04), sky * 0.7, 0.1 + 0.5 * fres);
      shopGlass = mix(shopGlass, vec3(0.85, 0.66, 0.4) * 0.5, step(0.5, sh) * 0.4 * (1.0 - fres));
      float awning = shop * step(0.04, sf) * step(sf, 0.96) * step(fh * 0.74, hy) * step(hy, fh * 0.98) * step(0.45, sh);
      vec3 ac = awnCol(fHash(vec2(sseg, bid * 5.0)));
      vec3 stripe = mix(ac, ac * 1.6 + 0.05, step(0.5, fract(uc / 0.45)) * near);
      vec3 gcol = base;
      gcol = mix(gcol, shopGlass, glassF);
      gcol = mix(gcol, stripe * (0.75 + 0.25 * smoothstep(fh * 0.74, fh * 0.98, hy)), awning);
      // houses and offices without shops: ordinary windows at street level too
      float ordW = (1.0 - shop) * inX * step(0.5, hy) * step(hy, fh * 0.85) * step(0.28, fy) * step(fy, 0.8);
      gcol = mix(gcol, pane, ordW);
      col = mix(col, gcol, gF * fine * inWall);
    } else {
      // 1960s walk-up flats: a window pair and a recessed balcony in every bay, a slab line at every floor
      float inWin = step(0.1, fx) * step(fx, 0.42);
      float win = inWin * step(0.3, fy) * step(fy, 0.8) * step(0.9, hy) * step(hy, total - 0.3);
      float inBal = step(0.52, fx) * step(fx, 0.94);
      float bal = inBal * step(0.06, fy) * step(fy, 0.82) * step(0.9, hy) * step(hy, total - 0.3);
      float rail = bal * step(fy, 0.4);
      float slab = step(abs(hy - fh * floor(hy / fh + 0.5)), 0.12) * step(0.9, hy);
      vec3 recess = mix(vec3(0.07, 0.065, 0.06), pane * 0.8, 0.25);
      col = mix(col, pane, win * k);
      col = mix(col, recess, bal * (1.0 - rail) * k);
      col = mix(col, base * 1.15 + 0.06, rail * k);
      col = mix(col, vec3(0.86, 0.83, 0.76), slab * k * 0.7);
      float gdoor = step(0.8, fHash(vec2(seg, bid * 7.0))) * step(hy, fh * 0.8) * step(0.0, hy) * step(0.3, fx) * step(fx, 0.7);
      col = mix(col, vec3(0.08, 0.07, 0.06), gdoor * k * (1.0 - step(fh, hy)));
    }
    col = mix(col, base * 0.82 + sky * 0.03, (1.0 - fine) * wallF * 0.9);
    diffuseColor.rgb = mix(diffuseColor.rgb, col, wallF);
`;

/** Windows, shutters, planks and roof tiles drawn from the surface id and world position. */
function facadeMaterial(style: Style) {
  // double-sided: from the street you look up at the underside of the eaves; with one-sided roofs it
  // vanished and left the gable edge of tall blocks hanging in the sky
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uShutA = { value: style.shutters[0] };
    shader.uniforms.uShutB = { value: style.shutters[1] };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float surf;\nattribute float baseY;\nattribute float topY;\nattribute float aux;\nvarying float vSurf;\nvarying float vBaseY;\nvarying float vTopY;\nvarying float vAux;\nvarying vec3 vFNormal;',
      )
      .replace(
        '#include <beginnormal_vertex>',
        '#include <beginnormal_vertex>\nvFNormal = normalize(mat3(modelMatrix) * objectNormal);\nvSurf = surf;\nvBaseY = baseY;\nvTopY = topY;\nvAux = aux;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uShutA;\nuniform vec3 uShutB;\nvarying float vSurf;\nvarying float vBaseY;\nvarying float vTopY;\nvarying float vAux;\nvarying vec3 vFNormal;\nfloat fHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }\nvec3 awnCol(float h) { return h < 0.2 ? vec3(0.1, 0.22, 0.15) : h < 0.4 ? vec3(0.36, 0.1, 0.11) : h < 0.6 ? vec3(0.09, 0.14, 0.27) : h < 0.8 ? vec3(0.5, 0.37, 0.14) : vec3(0.14, 0.14, 0.15); }')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec3 n = normalize(vFNormal);
  vec3 wp = vAtmoWorld;
  float camD = length(wp - cameraPosition);
  float detail = 1.0 - smoothstep(500.0, 1500.0, camD);
  float wallF = 1.0 - smoothstep(0.25, 0.5, abs(n.y));
  float u = abs(n.x) > abs(n.z) ? wp.z : wp.x;
  float hy = wp.y - vBaseY;
  int sid = int(vSurf + 0.5);
  if (sid == 1) {
    // vertical larch boards, weathered darker towards the bottom and in the joints
    float board = fract(u / 0.22);
    float joint = smoothstep(0.0, 0.06, board) * smoothstep(1.0, 0.94, board);
    float grain = 0.88 + 0.12 * fHash(vec2(floor(u / 0.22), 3.0));
    diffuseColor.rgb *= mix(0.62, 1.0, joint * detail + (1.0 - detail)) * grain;
  } else if (sid == 2) {
    // roof tiles: rows and staggered courses, moss-darkened towards the eaves
    vec2 t = vec2(wp.x + wp.z, wp.y * 3.2);
    float row = fract(t.y);
    float course = fract(t.x / 0.3 + floor(t.y) * 0.5);
    float tile = smoothstep(0.0, 0.12, row) * (0.85 + 0.15 * smoothstep(0.0, 0.1, course) * smoothstep(1.0, 0.9, course));
    diffuseColor.rgb *= mix(1.0, 0.75 + 0.25 * tile, detail) * (0.9 + 0.2 * fHash(floor(t)));
  } else if (sid == 0 || sid == 5) {
    // plaster with a socle, windows with frames, shutters and sky reflections
    diffuseColor.rgb *= 0.96 + 0.04 * fHash(floor(wp.xz * 3.0) + floor(wp.y * 3.0));
    float socle = 1.0 - step(0.55, hy);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.72, 0.7, 0.66), socle * wallF);
    float bay = sid == 5 ? 2.2 : 3.1;
    float fx = fract(u / bay);
    float fy = fract((hy - 0.45) / 2.9);
    float ww = sid == 5 ? 0.42 : 0.2;
    float win = step(0.5 - ww, fx) * step(fx, 0.5 + ww) * step(0.3, fy) * step(fy, 0.78) * step(0.4, hy);
    float frame = win * (1.0 - step(0.5 - ww + 0.025, fx) * step(fx, 0.5 + ww - 0.025) * step(0.32, fy) * step(fy, 0.76));
    float mullion = win * step(abs(fx - 0.5), 0.008) * (sid == 0 ? 1.0 : 0.0);
    // shutters beside rural windows (green or brown per house)
    float shut = (sid == 0 ? 1.0 : 0.0) * step(0.3, fy) * step(fy, 0.78) * step(0.4, hy) *
      (step(0.5 - ww - 0.13, fx) * step(fx, 0.5 - ww - 0.01) + step(0.5 + ww + 0.01, fx) * step(fx, 0.5 + ww + 0.13));
    float house = fHash(floor(vec2(vBaseY, vBaseY * 0.37)));
    vec3 shutterCol = house > 0.5 ? uShutA : uShutB;
    vec3 v = normalize(wp - cameraPosition);
    vec3 r = reflect(v, n);
    vec3 sky = atmoSky(normalize(vec3(r.x, abs(r.y) * 0.6 + 0.05, r.z)));
    float fres = 0.15 + 0.6 * pow(1.0 - abs(dot(-v, n)), 3.0);
    vec3 glass = mix(vec3(0.04, 0.05, 0.06), sky * 0.9, fres);
    float k = wallF * detail;
    diffuseColor.rgb = mix(diffuseColor.rgb, shutterCol * (0.85 + 0.15 * step(0.5, fract(fy * 9.0))), shut * k);
    diffuseColor.rgb = mix(diffuseColor.rgb, glass, win * k);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.9, 0.86), max(frame, mullion) * k);
  } else if (sid == 7 || sid == 8) {
    // Mallorca: lime render (7) or marès / limestone ashlar (8); tall windows with green
    // louvred shutters (persianes), many half closed; a dark stone socle on render
    if (sid == 8) {
      float row = floor(hy / 0.42);
      float bx = (u + fHash(vec2(row, 1.0)) * 2.0) / (0.55 + 0.25 * fHash(vec2(row, 5.0)));
      float jy = smoothstep(0.0, 0.07, fract(hy / 0.42)) * smoothstep(1.0, 0.93, fract(hy / 0.42));
      float jx = smoothstep(0.0, 0.05, fract(bx)) * smoothstep(1.0, 0.95, fract(bx));
      float st = fHash(vec2(floor(bx), row));
      diffuseColor.rgb *= mix(0.78, 1.0, jx * jy * detail + (1.0 - detail)) * (0.86 + 0.24 * st);
    } else {
      diffuseColor.rgb *= 0.95 + 0.05 * fHash(floor(wp.xz * 2.0) + floor(wp.y * 2.0));
      float socle = 1.0 - step(0.6, hy);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55, 0.5, 0.44), socle * wallF);
    }
    float fx = fract(u / 3.4);
    float fy = fract((hy - 0.5) / 3.0);
    float ww = 0.15;
    float win = step(0.5 - ww, fx) * step(fx, 0.5 + ww) * step(0.18, fy) * step(fy, 0.8) * step(0.6, hy);
    float frame = win * (1.0 - step(0.5 - ww + 0.03, fx) * step(fx, 0.5 + ww - 0.03) * step(0.2, fy) * step(fy, 0.78));
    float cell = fHash(floor(vec2(u / 3.4, (hy - 0.5) / 3.0)) + vBaseY);
    // louvres: horizontal slats; closed shutters cover the window, open ones fold to the sides
    float slat = 0.75 + 0.25 * step(0.5, fract(fy * 26.0));
    vec3 green = (fHash(floor(vec2(vBaseY, vBaseY * 0.37))) > 0.5 ? uShutA : uShutB) * slat;
    float closed = step(0.45, cell);
    float side = step(0.5 - ww - 0.15, fx) * step(fx, 0.5 - ww - 0.005) + step(0.5 + ww + 0.005, fx) * step(fx, 0.5 + ww + 0.15);
    side *= step(0.18, fy) * step(fy, 0.8) * step(0.6, hy) * (1.0 - closed);
    vec3 v = normalize(wp - cameraPosition);
    vec3 r = reflect(v, n);
    vec3 glass = mix(vec3(0.03, 0.035, 0.04), atmoSky(normalize(vec3(r.x, abs(r.y) * 0.6 + 0.05, r.z))) * 0.8, 0.15 + 0.5 * pow(1.0 - abs(dot(-v, n)), 3.0));
    float k = wallF * detail;
    diffuseColor.rgb = mix(diffuseColor.rgb, mix(glass, green, closed), win * k);
    diffuseColor.rgb = mix(diffuseColor.rgb, green, side * k);
    diffuseColor.rgb = mix(diffuseColor.rgb, sid == 8 ? vec3(0.86, 0.82, 0.74) : vec3(0.94, 0.92, 0.88), frame * k * (1.0 - closed));
  } else if (sid == 6) {
    // timber chalet: horizontal larch boards on a stone plinth, white-framed windows
    float board = fract(hy / 0.19);
    float joint = smoothstep(0.0, 0.08, board) * smoothstep(1.0, 0.92, board);
    diffuseColor.rgb *= mix(0.68, 1.0, joint * detail + (1.0 - detail)) * (0.86 + 0.14 * fHash(vec2(floor(hy / 0.19), floor(u / 4.0))));
    float plinth = (1.0 - step(0.7, hy)) * wallF;
    vec3 stoneCol = vec3(0.55, 0.53, 0.5) * (0.8 + 0.3 * fHash(floor(vec2(u * 3.0, hy * 4.0))));
    diffuseColor.rgb = mix(diffuseColor.rgb, stoneCol, plinth);
    float fx = fract(u / 2.6);
    float fy = fract((hy - 0.7) / 2.8);
    float win = step(0.3, fx) * step(fx, 0.7) * step(0.32, fy) * step(fy, 0.76) * step(0.9, hy) * wallF * detail;
    float frame = win * (1.0 - step(0.32, fx) * step(fx, 0.68) * step(0.35, fy) * step(fy, 0.73));
    vec3 v = normalize(wp - cameraPosition);
    vec3 r = reflect(v, n);
    vec3 glass = mix(vec3(0.05, 0.05, 0.06), atmoSky(normalize(vec3(r.x, abs(r.y) * 0.6 + 0.05, r.z))) * 0.85, 0.2 + 0.5 * pow(1.0 - abs(dot(-v, n)), 3.0));
    diffuseColor.rgb = mix(diffuseColor.rgb, glass, win);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.88, 0.84), frame);
  } else if (sid == 9 || sid == 10) {
    // Manhattan. The street grid is turned 29° off north: measure along the wall, not along an axis
    float uc = dot(wp.xz, vec2(-n.z, n.x)) / max(length(n.xz), 0.001);
    float bid = fHash(floor(vec2(vBaseY * 7.31, vTopY * 3.17)));
    float total = vTopY - vBaseY;
    vec3 v = normalize(wp - cameraPosition);
    vec3 r = reflect(v, n);
    vec3 sky = atmoSky(normalize(vec3(r.x, abs(r.y) * 0.6 + 0.05, r.z)));
    float fres = pow(max(1.0 - abs(dot(-v, n)), 0.0), 3.0);
    if (sid == 9) {
      // masonry apartment house. Per-building proportions come from hashes of the block's own heights, so
      // neighbours differ: bay width, window proportions, a base of two or three storeys, piers, belt courses
      float h2 = fHash(vec2(bid, 2.0)), h3 = fHash(vec2(bid, 3.0)), h4 = fHash(vec2(bid, 4.0));
      float h5 = fHash(vec2(bid, 5.0)), h6 = fHash(vec2(bid, 6.0)), h7 = fHash(vec2(bid, 7.0));
      float h8 = fHash(vec2(bid, 8.0)), h9 = fHash(vec2(bid, 9.0)), h10 = fHash(vec2(bid, 10.0));
      float fh = 3.0 + 0.45 * bid;
      float bay = 2.6 + 2.0 * h2;
      // aux > 0: the geometry's stone base is this tall (Buildings.ts addManhattanBlock); aux < 0: an upper tier, no street floor
      float geoB = step(0.5, vAux);
      float noBase = step(vAux, -0.5);
      float gfh = max(fh * (1.15 + 0.35 * h3) * (1.0 - noBase), 0.001);
      float tall = step(18.0, total);
      float mid = step(12.0, total);
      float baseTop = mix(gfh + tall * (1.0 + step(0.6, h4)) * fh, vAux, geoB) * (1.0 - noBase);
      // the cornice, fillet and frieze of a tall house take the top two to three metres
      float cz = 1.7 + 0.6 * step(30.0, total) + 0.5 * step(60.0, total);
      // windows smaller than a pixel flicker: fade the pattern to its mean with distance
      float fine = wallF * (1.0 - smoothstep(0.22, 0.6, max(fwidth(uc) / bay, fwidth(hy) / fh)));
      float near = 1.0 - smoothstep(25.0, 90.0, camD);
      vec3 base = diffuseColor.rgb;
      // a loose drift per building and per patch, so rows of the same stone do not read as one tint
      base *= vec3(1.0 + 0.07 * (h5 - 0.5), 1.0, 1.0 - 0.09 * (h5 - 0.5));
      // each hashed patch fades to its mean once it is a pixel or two wide, or it aliases into streaks
      float calm1 = 1.0 - smoothstep(0.2, 0.6, max(fwidth(uc) / 5.0, fwidth(hy) / 7.0));
      float calm2 = 1.0 - smoothstep(0.2, 0.6, fwidth(uc) / 1.7);
      base *= 1.0 + (0.9 + 0.14 * fHash(floor(vec2(uc / 5.0, hy / 7.0)) + bid) - 0.97) * calm1;
      base *= 1.0 + (0.97 + 0.06 * fHash(vec2(floor(uc / 1.7), bid)) - 1.0) * calm2;
      // bricks (rows with a running bond) and limestone coursing, both only from close by
      float brick = fHash(floor(vec2(uc / 0.21 + 0.5 * floor(hy / 0.075), hy / 0.075)));
      float luma = dot(base, vec3(0.3, 0.55, 0.15));
      float lime = smoothstep(0.3, 0.5, luma);
      float rowF = fract(hy / mix(0.075, 0.55, lime));
      base *= 1.0 + (brick - 0.5) * mix(0.2, 0.06, lime) * near;
      base *= 1.0 - 0.1 * lime * near * (1.0 - smoothstep(0.0, 0.07, rowF));
      // soot gathers under the cornice and splashes up from the street
      base *= 1.0 - 0.14 * smoothstep(7.0, 0.0, total - hy) * mid - 0.1 * smoothstep(3.0, 0.0, hy);
      vec3 stone = mix(vec3(0.66, 0.63, 0.57), base, 0.3);
      float podium = (1.0 - step(baseTop, hy)) * mid;
      // rusticated base: a groove between courses, drawn while a course is still several pixels tall
      float groove = (1.0 - smoothstep(0.0, 0.09, fract(hy / 0.55))) * (1.0 - smoothstep(0.12, 0.4, fwidth(hy) / 0.55));
      float ashlar = 0.94 + 0.06 * fHash(vec2(floor(uc / 0.9), floor(hy / 0.55)));
      vec3 podCol = mix(stone * (1.0 - 0.3 * groove) * ashlar * mix(1.0, 0.9, lime), base * (1.0 - 0.22 * groove) * ashlar, geoB);
      base = mix(base, podCol, podium);
      // belt courses: over the base, and on tall houses every few storeys
      float hy2 = hy - gfh;
      float beltN = 4.0 + floor(h6 * 3.0);
      float beltPos = abs(hy2 - fh * beltN * floor(hy2 / (fh * beltN) + 0.5));
      float belt = max(step(beltPos, 0.2) * step(40.0, total) * step(baseTop + fh, hy), tall * step(abs(hy - baseTop), 0.2));
      float cornice = smoothstep(cz - 0.2, cz - 0.4, total - hy) * mid;
      float shadowLine = smoothstep(cz + 0.8, cz, total - hy) * step(cz, total - hy) * mid;
      base = mix(base, mix(stone, vec3(0.72, 0.69, 0.62), 0.6), max(belt, cornice));
      base *= 1.0 - 0.28 * shadowLine;
      // piers: a vertical stone strip every few bays on the upper floors of some houses
      float pierEvery = 3.0 + floor(h7 * 3.0);
      float fp = fract(uc / (bay * pierEvery));
      float pier = step(0.55, h8) * step(min(fp, 1.0 - fp) * bay * pierEvery, 0.32) * (1.0 - podium) * step(gfh, hy) * mid;
      base = mix(base, stone * 1.04, pier * near);
      // upper floors
      float fx = fract(uc / bay);
      float fy = fract(hy2 / fh);
      float ww = 0.15 + 0.13 * h9;
      float wy0 = 0.2 + 0.06 * h10, wy1 = 0.76 + 0.08 * h2;
      float inWx = step(0.5 - ww, fx) * step(fx, 0.5 + ww);
      float up = step(0.0, hy2) * step(cz, total - hy);
      float win = inWx * step(wy0, fy) * step(fy, wy1) * up;
      float cell = fHash(floor(vec2(uc / bay, hy2 / fh)) + bid * 31.0);
      // sill and lintel in stone; a drip stain under the sill that fades down the wall
      float sill = inWx * step(wy0 - 0.07, fy) * step(fy, wy0) * up;
      float lintel = inWx * step(wy1, fy) * step(fy, wy1 + 0.07) * up;
      float stain = step(0.5 - ww * 0.8, fx) * step(fx, 0.5 + ww * 0.8) * smoothstep(wy0 - 0.4, wy0 - 0.08, fy) * (1.0 - step(wy0 - 0.07, fy)) * up;
      // the opening is a recess: shadow under the head and down one side
      float rx = (fx - (0.5 - ww)) / (2.0 * ww);
      float ry = (wy1 - fy) / (wy1 - wy0);
      float reveal = 1.0 - 0.55 * smoothstep(0.22, 0.0, ry) - 0.4 * smoothstep(0.16, 0.0, rx);
      float sash = win * max(step(abs(fy - mix(wy0, wy1, 0.55)), 0.012), step(abs(fx - 0.5), 0.006));
      float blind = step(0.55, cell) * step(0.8 - 0.5 * fract(cell * 7.0), (fy - wy0) / (wy1 - wy0));
      vec3 pane = mix(vec3(0.035, 0.04, 0.05), sky * 0.85, 0.12 + 0.6 * fres);
      pane = mix(pane, vec3(0.62, 0.59, 0.52), blind * 0.85);
      pane = mix(pane, vec3(0.9, 0.72, 0.42) * 0.55, step(0.93, cell) * (1.0 - blind));
      pane *= reveal;
      // street floor: shop fronts, lobby entrances, windows in the stone
      float gy = hy / gfh;
      float shopW = 3.4 + 2.6 * h3;
      float seg = floor(uc / shopW);
      float sf = fract(uc / shopW);
      float sh = fHash(vec2(seg, bid * 13.0));
      float per = 4.0 + floor(h8 * 3.0);
      float ent = step(mod(seg, per), 0.5) * mid;
      float retail = step(0.4, h4) * (1.0 - ent);
      float ground = 1.0 - step(gfh, hy);
      vec3 ac = awnCol(fHash(vec2(seg * step(0.6, h6) + 3.0, bid * 5.0)));
      vec3 shopGlass = mix(vec3(0.05, 0.045, 0.04), sky * 0.7, 0.1 + 0.5 * fres);
      shopGlass = mix(shopGlass, vec3(0.85, 0.66, 0.4) * 0.5, step(0.5, sh) * 0.45 * (1.0 - fres));
      vec3 gcol = base;
      // shop: glass over a dark bulkhead, an awning or a sign band above
      float shopOpen = step(0.07, sf) * step(sf, 0.93) * step(0.1, gy) * step(gy, 0.7);
      gcol = mix(gcol, shopGlass * (0.55 + 0.45 * smoothstep(0.52, 0.66, 1.0 - gy)), retail * shopOpen);
      gcol = mix(gcol, shopGlass * 0.4, retail * step(0.04, sf) * step(sf, 0.96) * step(gy, 0.1));
      float awning = step(0.55, sh) * retail * step(0.03, sf) * step(sf, 0.97) * step(0.56, gy) * step(gy, 0.8);
      vec3 stripe = mix(ac, ac * 1.6 + 0.05, step(0.5, fract(uc / 0.5)) * near);
      gcol = mix(gcol, stripe * (0.75 + 0.25 * smoothstep(0.56, 0.8, gy)), awning);
      float signBand = (1.0 - step(0.55, sh)) * retail * step(0.72, gy) * step(gy, 0.9) * step(0.04, sf) * step(sf, 0.96);
      gcol = mix(gcol, ac * 0.55, signBand);
      gcol = mix(gcol, ac * 1.4 + 0.08, signBand * step(0.78, gy) * step(gy, 0.84) * step(0.2, sf) * step(sf, 0.8) * near);
      // lobby: dark double door in a stone surround, with a canopy on bigger houses
      float door = ent * step(0.22, sf) * step(sf, 0.78) * step(gy, 0.64);
      float surround = ent * step(0.12, sf) * step(sf, 0.88) * step(gy, 0.74) * (1.0 - door);
      gcol = mix(gcol, stone * 1.08, surround);
      gcol = mix(gcol, vec3(0.04, 0.035, 0.03) + vec3(0.5, 0.38, 0.2) * step(0.45, fract(sf * 9.0)) * 0.12 * near, door);
      float big = step(20.0, total);
      float canopy = ent * step(0.05, sf) * step(sf, 0.95) * step(0.66, gy) * step(gy, 0.78) * big;
      gcol = mix(gcol, ac * 0.9, canopy);
      gcol *= 1.0 - 0.45 * ent * big * step(0.54, gy) * step(gy, 0.66) * step(0.12, sf) * step(sf, 0.88);
      // plain stone ground floor: tall windows in the rustication
      float gwin = (1.0 - retail) * (1.0 - ent) * step(0.28, sf) * step(sf, 0.72) * step(0.3, gy) * step(gy, 0.78);
      gcol = mix(gcol, mix(vec3(0.03, 0.035, 0.04), sky * 0.5, 0.1 + 0.5 * fres), gwin);
      vec3 col = base;
      col = mix(col, stone * 1.1, max(sill, lintel) * fine);
      col = mix(col, base * 0.82, stain * 0.5 * near);
      col = mix(col, pane, win * fine);
      col = mix(col, vec3(0.78, 0.76, 0.72), sash * fine * near);
      col = mix(col, gcol, ground * fine);
      // the mean of wall and windows where the pattern is too fine to draw
      float meanDark = mix(0.86, 0.76, ground);
      col = mix(col, base * meanDark + sky * 0.03, (1.0 - fine) * wallF * 0.9);
      diffuseColor.rgb = mix(diffuseColor.rgb, col, wallF);
    } else {
      // curtain wall: glass floor to floor between slim mullions, an opaque spandrel band at every slab,
      // a dark mechanical crown. The glass reflects the sky: low floors the haze of the street, high ones the zenith.
      // aux names the tower's character: 1 pale concrete grid of deep square windows (432 Park Avenue), 2 dark glass,
      // 3 silvery glass, 4 a 1960s dark box with ribbon windows, 0 plain curtain wall
      float vC = step(0.5, vAux) * step(vAux, 1.5);
      float vD = step(1.5, vAux) * step(vAux, 2.5);
      float vS = step(2.5, vAux) * step(vAux, 3.5);
      float vB = step(3.5, vAux);
      float fh = mix(3.8 + 0.5 * bid, 3.35, vC);
      fh = mix(fh, 4.1, vD); fh = mix(fh, 4.3, vS); fh = mix(fh, 3.7, vB);
      float bay = mix(1.5 + 0.5 * fHash(vec2(bid, 9.0)), 3.35, vC);
      bay = mix(bay, 1.55, vD); bay = mix(bay, 1.7, vS); bay = mix(bay, 2.6, vB);
      float fine = 1.0 - smoothstep(0.25, 0.7, max(fwidth(uc) / bay, fwidth(hy) / fh));
      float fy = fract(hy / fh);
      float fx = fract(uc / bay);
      float spW = mix(0.2, 0.12, vD); spW = mix(spW, 0.16, vS); spW = mix(spW, 0.42, vB);
      float spandrel = step(fy, spW) * fine * (1.0 - vC);
      float mullion = step(abs(fx - 0.5), mix(0.035, 0.018, vD + vS)) * fine * (1.0 - vC) * (1.0 - vB * 0.6);
      vec2 ci = floor(vec2(uc / bay, hy / fh));
      float cell = fHash(ci + bid * 17.0);
      // groups of panels and whole floors vary in tint, like blinds half drawn and different glass lots
      float lot = fHash(floor(vec2(uc / (bay * 4.0), hy / (fh * 2.0))) + bid * 5.0);
      float floorV = fHash(vec2(ci.y, bid * 3.0));
      float g = clamp(hy / max(total, 1.0), 0.0, 1.0);
      float bandFine = 1.0 - smoothstep(0.2, 0.6, fwidth(hy) / (fh * 4.0));
      vec3 tint = diffuseColor.rgb;
      // facets of a round tower turn the mirror direction fast: average it with the view direction for a calmer sky
      vec2 rh = mix(v.xz, r.xz, 0.45);
      vec3 skyC = atmoSky(normalize(vec3(rh.x, 0.04 + 0.5 * g, rh.y)));
      vec3 cityC = atmoSky(normalize(vec3(rh.x, 0.02, rh.y))) * 0.5 + tint * 0.1;
      vec3 refl = mix(cityC, skyC, smoothstep(0.0, 0.3, g));
      vec3 glassCol = mix(tint * 0.5, refl * mix(vec3(1.0), tint * 2.2, 0.35), 0.4 + 0.55 * fres);
      // walls turned to the sun are brighter, with a glint where the reflection meets it
      vec2 sxz = uSunDir.xz / max(length(uSunDir.xz), 1e-4);
      // round towers are faceted: a soft term keeps the facets from striping at distance
      float sunSide = mix(0.4, clamp(dot(n.xz, sxz), 0.0, 1.0), 0.6);
      float sunUp = clamp(uSunDir.y * 2.0 + 0.2, 0.0, 1.0);
      glassCol *= 1.0 + 0.5 * sunSide * sunUp - 0.12 * (1.0 - sunSide);
      glassCol += uSunColor * 0.22 * pow(max(dot(r, uSunDir), 0.0), 12.0) * sunUp * fine;
      glassCol *= (0.93 + 0.14 * cell * fine) * (0.94 + 0.12 * lot * fine) * (0.97 + 0.06 * floorV * bandFine);
      glassCol = mix(glassCol, tint * 0.55, spandrel * 0.7);
      glassCol = mix(glassCol, tint * 0.3 + 0.02, mullion * 0.8);
      // 432 Park Avenue: a pale concrete grid with a deep square window in every cell. The wall is the concrete, the
      // window a recess: shadow under the head and on one side, sky in the glass
      float wx = abs(fx - 0.5), wy = abs(fy - 0.5);
      float inWin = step(wx, 0.31) * step(wy, 0.31);
      float rvx = (fx - 0.19) / 0.62, rvy = (0.81 - fy) / 0.62;
      float recess = 1.0 - 0.5 * smoothstep(0.2, 0.0, rvy) - 0.3 * smoothstep(0.14, 0.0, rvx);
      vec3 concrete = tint * (0.96 + 0.06 * fHash(ci + bid)) ;
      vec3 winC = mix(vec3(0.03, 0.035, 0.04), refl * 0.55, 0.15 + 0.5 * fres) * recess;
      float cFine = fine * inWin;
      vec3 concreteCol = mix(concrete, winC, cFine);
      concreteCol = mix(concreteCol, concrete * 0.78, (1.0 - fine) * 0.5 + 0.0);
      // vertical fins and horizontal mechanical bands: the large scale that survives at a kilometre, where a
      // window is under a pixel. Neighbours get different periods so they do not read as one pattern
      float Pf = 6.0 + 5.0 * fHash(vec2(bid, 21.0));
      float finW = 0.22 * Pf;
      float finFade = 1.0 - smoothstep(0.2, 0.6, fwidth(uc) / finW);
      float fin = step(fract(uc / Pf), 0.22) * finFade;
      float finAmp = (vS * 0.2 + vD * 0.16 + vB * 0.0 + (1.0 - vS - vD - vB - vC) * 0.1);
      glassCol *= 1.0 + finAmp * (fin - 0.22 * finFade);
      float pm = fh * (9.0 + floor(fHash(vec2(bid, 23.0)) * 4.0));
      float mechF = 1.0 - smoothstep(0.2, 0.6, fwidth(hy) / (2.0 * fh));
      float mech = step(fract((hy - 0.5 * pm) / pm), 2.0 * fh / pm) * step(pm, hy) * step(70.0, total) * mechF * (1.0 - vC);
      glassCol = mix(glassCol, tint * 0.5 * (0.8 + 0.2 * step(0.5, fract(hy / 0.7)) * fine) + 0.02, mech * 0.6);
      // mechanical crown: opaque louvred band under the roof, and a darker lobby floor at the foot
      float tallT = step(40.0, total);
      float crown = step(total - hy, clamp(total * 0.035, 3.0, 9.0)) * tallT;
      float louvre = 0.8 + 0.2 * step(0.5, fract(hy / 0.7)) * fine;
      glassCol = mix(glassCol, tint * 0.32 * louvre + 0.015, crown);
      concreteCol = mix(concreteCol, tint * 0.55 * louvre, crown);
      glassCol = mix(glassCol, concreteCol, vC);
      glassCol *= 1.0 - 0.35 * step(hy, 6.0) * tallT;
      diffuseColor.rgb = mix(diffuseColor.rgb, glassCol, wallF);
    }
  } else if (sid >= 14 && sid <= 16) {
${SYDNEY_GLSL}
  } else if (sid == 11 || sid == 12) {
    // Vienna Ringstrasse. 11: Gründerzeit plaster block, 12: monument stone (wider bays, pilasters, bigger pediments).
    // Storeys from the ground up: rusticated ground floor, mezzanine, piano nobile (tall windows under pediments),
    // plain upper floors, and the cornice under the eaves (geometry). Measured along the wall like Manhattan.
    float mono = sid == 12 ? 1.0 : 0.0;
    float uc = dot(wp.xz, vec2(-n.z, n.x)) / max(length(n.xz), 0.001);
    float bid = fHash(vec2(vBaseY * 7.31 + diffuseColor.r * 91.0, vTopY * 3.17 + diffuseColor.g * 57.0));
    float total = vTopY - vBaseY;
    float h2 = fHash(vec2(bid, 2.0)), h3 = fHash(vec2(bid, 3.0)), h4 = fHash(vec2(bid, 4.0));
    float h5 = fHash(vec2(bid, 5.0)), h6 = fHash(vec2(bid, 6.0)), h7 = fHash(vec2(bid, 7.0));
    vec3 v = normalize(wp - cameraPosition);
    vec3 r = reflect(v, n);
    vec3 sky = atmoSky(normalize(vec3(r.x, abs(r.y) * 0.6 + 0.05, r.z)));
    float fres = pow(max(1.0 - abs(dot(-v, n)), 0.0), 3.0);
    float fwU = fwidth(uc), fwY = fwidth(hy);
    float near = 1.0 - smoothstep(25.0, 90.0, camD);
    float bay = mix(2.55, 3.3, h2) * (1.0 + 0.55 * mono);
    float gfh = mix(3.9, 4.8, h3) * (1.0 + 0.12 * mono);
    // aux > 0: the block's geometry fixes the storeys (ViennaBlock.ts: stone base, moulding, balcony band follow them);
    // aux < 0: a turret or other upper block with no street floor
    float geo = step(0.5, vAux);
    float upOnly = step(vAux, -0.5);
    float mzh = mix(mix(2.8, 3.4, h4), 3.2, geo);
    float pnh = mix(mix(4.4, 5.2, h5), 4.8, geo) * (1.0 + 0.1 * mono);
    float yG = min(gfh, total * 0.45);
    yG = mix(yG, vAux - mzh * step(17.0, total), geo);
    yG *= 1.0 - upOnly;
    float yM = (yG + mzh * step(17.0, total)) * (1.0 - upOnly);
    float yP = (yM + pnh * step(10.5, total)) * (1.0 - upOnly);
    // the heavy cornice and its fillet take the top two to three metres of a tall block
    float cz = mix(mix(2.0, 2.9, step(17.0, total)), 1.7, upOnly);
    float rem = max(total - cz - yP, 0.0);
    float nUp = max(floor(rem / 3.7 + 0.5), 0.0);
    float fhu = rem / max(nUp, 1.0);
    float zone = 0.0, y0 = 0.0, fh = max(yG, 0.5);
    if (hy >= yG && hy < yM) { zone = 1.0; y0 = yG; fh = mzh; }
    else if (hy >= yM && hy < yP) { zone = 2.0; y0 = yM; fh = pnh; }
    else if (hy >= yP && hy < total - cz) { zone = 3.0; y0 = yP; fh = fhu; }
    else if (hy >= total - cz) { zone = 4.0; y0 = total - cz; fh = cz; }
    float rawY = (hy - y0) / fh;
    float fIdx = zone > 2.5 ? floor(rawY) : 0.0;
    float fy = zone > 2.5 ? rawY - fIdx : clamp(rawY, 0.0, 1.0);
    float bi = floor(uc / bay);
    float fx = fract(uc / bay);
    float cell = fHash(vec2(bi, fIdx + zone * 7.0 + bid * 31.0));
    float fine = wallF * (1.0 - smoothstep(0.22, 0.6, max(fwU / bay, fwY / fh)));
    vec3 base = diffuseColor.rgb;
    float calm = 1.0 - smoothstep(0.2, 0.6, max(fwU / 3.0, fwY / 3.0));
    base *= 1.0 + (0.9 + 0.2 * fHash(floor(vec2(uc / 3.0, hy / 3.0)) + bid) - 1.0) * calm;
    // soot under the cornice and splash from the street
    base *= 1.0 - 0.12 * smoothstep(8.0, 0.0, total - hy) - 0.1 * smoothstep(2.5, 0.0, hy);
    vec3 stone = mix(base, vec3(0.9, 0.88, 0.82), mix(0.5, 0.3, mono));
    vec3 pane = mix(vec3(0.035, 0.04, 0.05), sky * 0.85, 0.12 + 0.6 * fres);
    vec3 col = base;
    if (zone < 0.5) {
      // rusticated ground floor: joints between courses, an arch or a rectangle in every bay, a portal now and then
      float groove = (1.0 - smoothstep(0.0, 0.1, fract(hy / 0.62))) * (1.0 - smoothstep(0.12, 0.4, fwY / 0.62));
      col = mix(base, base * 0.9, 0.55) * (1.0 - 0.28 * groove);
      float portal = step(mod(bi, 3.0 + floor(h6 * 3.0)), 0.5) * step(0.2, h7);
      float ow = mix(0.27, 0.36, h3) * (1.0 - 0.1 * portal);
      float arched = max(step(0.5, h4), mono);
      float topW = mix(0.76, 0.88, h6);
      float rad = ow * bay / fh;
      float cy = topW - rad;
      float dx = (fx - 0.5) * bay, dyy = (fy - cy) * fh;
      float inArch = step(length(vec2(dx, dyy)), ow * bay) * step(cy, fy);
      float inRect = step(abs(fx - 0.5), ow) * step(0.1, fy) * step(fy, cy);
      float shop = mix(step(abs(fx - 0.5), ow) * step(0.1, fy) * step(fy, topW), max(inRect, inArch), arched);
      float door = portal * step(abs(fx - 0.5), 0.3) * step(fy, 0.84);
      float rim = step(abs(fx - 0.5), ow + 0.05) * step(0.07, fy) * step(fy, topW + 0.05) - shop;
      float doorRim = portal * step(abs(fx - 0.5), 0.38) * step(fy, 0.92) - door;
      vec3 shopCol = mix(mix(vec3(0.03, 0.035, 0.04), sky * 0.55, 0.1 + 0.5 * fres), vec3(0.8, 0.62, 0.36) * 0.5, step(0.55, cell) * 0.5 * (1.0 - fres));
      col = mix(col, stone, clamp(max(rim, doorRim), 0.0, 1.0) * fine);
      col = mix(col, shopCol * (0.8 + 0.2 * smoothstep(0.1, 0.9, fy)), shop * (1.0 - portal) * fine);
      // shop fronts: a solid bulkhead under the glass, a transom and a centre mullion
      col = mix(col, stone * 0.7, shop * (1.0 - portal) * step(fy, 0.26) * fine);
      col = mix(col, vec3(0.8, 0.78, 0.72), shop * (1.0 - portal) * max(step(abs(fx - 0.5), 0.012), step(abs(fy - 0.7), 0.012)) * fine * near);
      col = mix(col, vec3(0.05, 0.04, 0.035), door * fine);
      col = mix(col, stone, step(0.93, fy) * fine);
    } else if (zone < 3.5) {
      // window row of this floor: opening bounds (fx half width, fy range), sill, and the pediment over it
      float ww = 0.2, wy0 = 0.18, wy1 = 0.74, pedH = 0.0, ped = 0.0;
      if (zone < 1.5) { ww = 0.22; wy0 = 0.3; wy1 = 0.74; }
      else if (zone < 2.5) {
        ww = 0.2 + 0.04 * h4 + 0.03 * mono; wy0 = 0.1; wy1 = 0.72; pedH = 0.2;
        ped = mono > 0.5 ? (mod(bi, 2.0) < 0.5 ? 1.0 : 2.0) : (step(0.4, h5) * (mod(bi, 2.0) < 0.5 ? 1.0 : 2.0));
      } else {
        ww = 0.19 + 0.04 * h4; wy1 = 0.7; pedH = 0.17;
        ped = (fIdx < 0.5 && h6 > 0.45 && mod(bi, 2.0) > 0.5) ? 2.0 : 0.0;
      }
      float frameW = 0.04 + 0.01 * mono;
      float inX = step(abs(fx - 0.5), ww);
      float win = inX * step(wy0, fy) * step(fy, wy1);
      float frame = step(abs(fx - 0.5), ww + frameW) * step(wy0 - 0.05, fy) * step(fy, wy1 + 0.045) - win;
      float sillB = step(abs(fx - 0.5), ww + frameW + 0.035) * step(wy0 - 0.095, fy) * step(fy, wy0 - 0.045);
      float pw = ww + frameW + 0.05;
      float pyy = (fy - wy1 - 0.045) / max(pedH, 0.05);
      float pt = 1.0 - pyy;
      float triP = step(abs(fx - 0.5), pw * pt) * step(0.0, pyy) * step(pyy, 1.0);
      float segE = length(vec2((fx - 0.5) / pw, pyy));
      float segP = step(segE, 1.0) * step(0.0, pyy);
      float pedm = ped > 1.5 ? segP : (ped > 0.5 ? triP : 0.0);
      float pedIn = ped > 1.5 ? step(segE, 0.62) * step(0.12, pyy) : (ped > 0.5 ? step(abs(fx - 0.5), pw * 0.6 * (pt - 0.12)) * step(0.12, pyy) : 0.0);
      float rx = (fx - (0.5 - ww)) / (2.0 * ww);
      float ry = (wy1 - fy) / (wy1 - wy0);
      float reveal = 1.0 - 0.5 * smoothstep(0.22, 0.0, ry) - 0.35 * smoothstep(0.16, 0.0, rx);
      float sash = win * max(step(abs(fx - 0.5), 0.012), step(abs(fy - mix(wy0, wy1, 0.64)), 0.011));
      // curtains and half-drawn blinds in some windows, a lit one now and then
      float blind = step(0.55, cell) * step(0.78 - 0.5 * fract(cell * 7.3), (fy - wy0) / (wy1 - wy0));
      vec3 pn = mix(pane, vec3(0.66, 0.62, 0.54), blind * 0.8);
      pn = mix(pn, vec3(0.9, 0.72, 0.42) * 0.5, step(0.94, cell) * (1.0 - blind));
      float belt = step(fy, 0.04) * step(1.5, zone);
      float pil = mono * (step(fx, 0.06) + step(0.94, fx)) * step(0.5, zone);
      col = base;
      col = mix(col, stone, clamp(frame + sillB + pedm + belt + pil, 0.0, 1.0) * fine);
      col = mix(col, base * 0.84, pedIn * fine * near);
      col = mix(col, pn * reveal, win * fine);
      col = mix(col, vec3(0.9, 0.88, 0.82), sash * fine * near);
      if (mono > 0.5 && zone < 2.5) {
        // colossal order over the mezzanine and the piano nobile: half-round columns on the bay joints (shaded across,
        // lit on one side) with a shadow strip beside them, and on every other monument an arched loggia in the recess
        float dj = min(fx, 1.0 - fx);
        float cc = clamp(dj / 0.1, 0.0, 1.0);
        float sideX = (fx < 0.5 ? -1.0 : 1.0) * cc;
        float cyl = (0.55 + 0.45 * sqrt(max(1.0 - cc * cc, 0.0))) * (1.0 - 0.16 * sideX);
        float isCol = step(dj, 0.1) * fine;
        float loggia = step(0.5, h6) * step(1.5, zone);
        float ax = (fx - 0.5) / 0.33;
        float spring = 0.6;
        float ayy = (fy - spring) / 0.3;
        float inLog = step(abs(ax), 1.0) * step(0.05, fy) * (step(fy, spring) + step(spring, fy) * step(length(vec2(ax, ayy)), 1.0));
        col = mix(col, base * 0.3 + sky * 0.02, inLog * loggia * fine);
        col = mix(col, col * 0.78, step(0.1, dj) * step(dj, 0.17) * fine);
        col = mix(col, stone * 1.04 * cyl, isCol);
      }
    }
    // the mean of wall and windows where the pattern is too fine to draw
    col = mix(col, base * mix(0.84, 0.76, step(zone, 0.5)) + sky * 0.03, (1.0 - fine) * wallF * 0.9);
    diffuseColor.rgb = mix(diffuseColor.rgb, col, wallF);
  } else if (sid == 13) {
    // slate, clay and verdigris roofs: courses of tiles in rows along the eaves, and dormers on the steep lower
    // slope of a mansard. The roof's own slope gives the metres along it, measured from the eaves.
    float sl = max(length(n.xz), 0.05);
    float run = dot(wp.xz, vec2(-n.z, n.x)) / sl;
    float up = (wp.y - vTopY) / sl;
    float fineR = 1.0 - smoothstep(0.25, 0.7, max(fwidth(run), fwidth(up)) / 0.3);
    float course = fract(up / 0.3);
    float stag = fract(run / 0.26 + floor(up / 0.3) * 0.5);
    float tl = 0.8 + 0.2 * smoothstep(0.0, 0.14, course) * smoothstep(0.0, 0.1, stag) * smoothstep(1.0, 0.9, stag);
    diffuseColor.rgb *= mix(1.0, tl * (0.9 + 0.2 * fHash(vec2(floor(run / 0.26), floor(up / 0.3)))), fineR * detail);
    // dormers are real geometry now (ViennaBlock.ts, dormers())
  } else if (sid == 4) {
    // geraniums: red blossoms over green leaves
    float b = fHash(floor(vec2(u * 9.0, wp.y * 9.0)));
    diffuseColor.rgb = mix(vec3(0.12, 0.3, 0.1), diffuseColor.rgb, step(0.42, b));
  }
}`,
      );
  };
  return patchMaterial(mat, { key: `facade6:${style.city ? 'city' : 'house'}` });
}

/** Whether any point along the footprint's edges (every ~1.5 m) lies within `clear` of the route. */
function reachesRoad(ring: Float32Array, index: RouteIndex, clear: number): boolean {
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const ax = ring[i * 2], az = ring[i * 2 + 1];
    const bx = ring[((i + 1) % n) * 2], bz = ring[((i + 1) % n) * 2 + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 1.5));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const hit = index.nearest(ax + (bx - ax) * t, az + (bz - az) * t, clear);
      if (hit.index >= 0 && hit.dist < clear) return true;
    }
  }
  return false;
}

export class Buildings extends WorldGroup {
  count = 0;
  centres: number[] = [];

  /** Buildings within r metres, normalised to 0..1 (1 ≈ town centre). */
  densityAt(x: number, z: number, r = 150): number {
    let n = 0;
    for (let i = 0; i < this.centres.length; i += 2) {
      const dx = this.centres[i] - x, dz = this.centres[i + 1] - z;
      if (dx * dx + dz * dz < r * r) n++;
    }
    return Math.min(1, n / 60);
  }

  /** `clear`: half the asphalt width plus a margin; no footprint may reach into it. */
  constructor(osm: OsmWorld, index: RouteIndex, heightAt: (x: number, z: number) => number, corridor = 320, biome: Biome = ALPINE, clear = 0) {
    super();
    const groups = new Map<string, { builder: Builder; ox: number; oz: number }>();
    const style = STYLES[biome.buildings] ?? STYLES.flachgau;
    const mat = facadeMaterial(style);
    osm.buildings.forEach((bld, i) => {
      const x = bld.ring[0];
      const z = bld.ring[1];
      // skyline: tall buildings count from any distance
      // 3D parts always come as a set: a tower without its podium would float
      if (!bld.part && bld.height < 30 && index.nearest(x, z, corridor).index < 0) return;
      // old-town streets are narrower than our road: a house whose footprint reaches the asphalt
      // would stand on it (St. Wolfgang, Kitzbühel). Leave it out; the street keeps its other walls
      if (clear > 0 && index.nearest(x, z, 120).index >= 0 && reachesRoad(bld.ring, index, clear)) return;
      const key = `${Math.floor(x / BUCKET)},${Math.floor(z / BUCKET)}`;
      let g = groups.get(key);
      if (!g) {
        g = { builder: new Builder(), ox: Math.floor(x / BUCKET) * BUCKET, oz: Math.floor(z / BUCKET) * BUCKET };
        groups.set(key, g);
      }
      addBuilding(bld, g.builder, heightAt, i + 1, g.ox, g.oz, style);
      this.centres.push(x, z);
      this.count++;
    });
    for (const { builder, ox, oz } of groups.values()) {
      if (!builder.pos.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(builder.pos, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(builder.col, 3));
      geo.setAttribute('surf', new THREE.Float32BufferAttribute(builder.surf, 1));
      geo.setAttribute('baseY', new THREE.Float32BufferAttribute(builder.base, 1));
      geo.setAttribute('topY', new THREE.Float32BufferAttribute(builder.top, 1));
      geo.setAttribute('aux', new THREE.Float32BufferAttribute(builder.aux, 1));
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(ox, 0, oz);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.add(mesh);
    }
  }
}
