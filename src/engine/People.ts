// People and their companions for the city routes: one scanned-style figure (person-stand.glb) cut apart at the
// shoulders, elbows, hips and knees so it can run, walk, stand, sit or pedal, dressed from a large pool of looks
// (height, build, skin, hair, hat, top, sleeves, trousers, shorts, tights, skirts, coats, shoes) so a crowd reads as
// individuals; geometry is built once per look and shared. Dogs and strollers are built from boxes.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { patchMaterial } from './atmosphere.ts';
import { markShared } from './dispose.ts';
import { loadModel } from './Landmarks.ts';

/** Height of the hip joint above the soles in the source model (m); the knee, elbow and shoulder joints of the mesh. */
const HIP = 0.9;
const KNEE = 0.49;
const ELBOW = 1.17;
const SHOULDER_Y = 1.42;
const SHOULDER_X = 0.21;

const SKINS = ['#f3d2b8', '#efc9a8', '#e6b896', '#d9a381', '#c68b66', '#a6704f', '#8a5a3c', '#6f4630', '#4f3123'];
const HAIRS = ['#0d0805', '#0d0805', '#2a1a0f', '#3a2616', '#4b2f1b', '#6b4426', '#7a5230', '#b99a63', '#c9a45e', '#dcc58a', '#8a3a1c', '#8d8d90', '#d8d6d0'];
const SHOES = ['#f1f1ee', '#f1f1ee', '#1b1d20', '#1b1d20', '#ff5d2e', '#25d5ff', '#e8ff3a', '#ff3d8b', '#5a4630', '#2d3a55'];
const PACKS = ['#1b3a2a', '#1a1c20', '#8c2a1e', '#2d4a6b', '#6b5a3a', '#4a2f5c'];
const RUN_TOPS = ['#ff5d2e', '#e8ff3a', '#25d5ff', '#ff3d8b', '#7bff5a', '#f4f4f2', '#1b1d20', '#2e5bff', '#ff9f1c', '#c0392b', '#8e44ad', '#16a085', '#f1c40f', '#7f8c8d'];
const RUN_BOTTOMS = ['#16181b', '#16181b', '#1d2a4a', '#2b2d33', '#3a3b3f', '#1b4fd8', '#8c1c13', '#2c4a38'];
const CASUAL_TOPS = ['#2e3a4d', '#4a4f57', '#7f8c8d', '#c0392b', '#1b1d20', '#f1f1ee', '#8a6a4a', '#3f6b4f', '#2e86de', '#d9d4c7', '#6b2f2a', '#d4a24a', '#34495e', '#b8b2a4', '#e8776b'];
const JEANS = ['#2a3a5c', '#3d4f73', '#1d2a4a', '#16181b', '#3a3b3f', '#b39b72', '#6b4f3a', '#d9d4c7', '#2c4a38'];
const COATS = ['#1d1f24', '#2b2e36', '#3a3d44', '#5a4a3a', '#6b6f78', '#7a1f2b', '#2d3a55', '#a8a092', '#4a5a4a', '#d9d4c7'];
const SUITS = ['#16181b', '#1d2a4a', '#2b2e36', '#3a3b3f', '#4a3f35'];
const BEACH_TOPS = ['#f1f1ee', '#ff5d2e', '#25d5ff', '#ff3d8b', '#f1c40f', '#2e86de', '#16a085', '#e8776b', '#f4e8c8', '#8e44ad', '#ff9f1c', '#7bff5a', '#c0392b'];
const BEACH_SHORTS = ['#1d2a4a', '#2e86de', '#d9d4c7', '#f1f1ee', '#c0392b', '#16a085', '#2b2d33', '#ff9f1c', '#b39b72'];
const HAT_COLOURS = ['#1b1d20', '#f1f1ee', '#2d4a6b', '#8c1c13', '#3f6b4f', '#7f8c8d', '#d9b43a', '#ff5d2e'];

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** What a look is for: runners in sportswear, park walkers in autumn clothes, city pavements, a summer beach. */
export type LookKind = 'run' | 'walk' | 'city' | 'beach';
type Hair = 'short' | 'long' | 'pony' | 'bun' | 'cap' | 'beanie' | 'sunhat' | 'bald';
type Bottom = 'long' | 'shorts' | 'tights' | 'skirt';

interface Look {
  kind: LookKind;
  top: THREE.Color;
  sleeve: 'long' | 'short' | 'none';
  bottom: Bottom;
  pants: THREE.Color;
  /** Bare legs or tights under shorts and skirts. */
  legs: THREE.Color;
  shoe: THREE.Color;
  skin: THREE.Color;
  hair: THREE.Color;
  style: Hair;
  hat: THREE.Color;
  /** A coat, dress or skirt hanging from the waist: colour and length (m). */
  hem: { col: THREE.Color; len: number } | null;
  pack: THREE.Color | null;
  /** Body height and width factors. */
  h: number;
  w: number;
}

function makeLook(kind: LookKind, r: () => number): Look {
  const pick = (a: readonly string[]) => new THREE.Color(a[Math.floor(r() * a.length)]);
  const share = <T,>(p: [number, T][]): T => {
    let x = r();
    for (const [w, v] of p) if ((x -= w) < 0) return v;
    return p[p.length - 1][1];
  };
  const skin = pick(SKINS), hair = pick(HAIRS), hat = pick(HAT_COLOURS), shoe = pick(SHOES);
  const dark = new THREE.Color('#1b1d20');
  let top: THREE.Color, sleeve: Look['sleeve'], bottom: Bottom, pants: THREE.Color, style: Hair;
  let hem: Look['hem'] = null, pack: THREE.Color | null = null, h = 0.93 + r() * 0.15, w = 0.9 + r() * 0.24;
  let legs = skin;
  if (kind === 'run') {
    top = pick(RUN_TOPS);
    sleeve = share<Look['sleeve']>([[0.25, 'none'], [0.6, 'short'], [0.15, 'long']]);
    bottom = share<Bottom>([[0.55, 'shorts'], [0.45, 'tights']]);
    pants = pick(RUN_BOTTOMS);
    style = share<Hair>([[0.3, 'short'], [0.3, 'pony'], [0.2, 'cap'], [0.08, 'bun'], [0.06, 'bald'], [0.06, 'beanie']]);
    if (r() < 0.1) pack = pick(PACKS);
    w = 0.88 + r() * 0.18;
    // tights under shorts are not a thing here; bare legs below the shorts
  } else if (kind === 'walk') {
    top = pick(CASUAL_TOPS);
    sleeve = share<Look['sleeve']>([[0.78, 'long'], [0.22, 'short']]);
    bottom = share<Bottom>([[0.72, 'long'], [0.1, 'shorts'], [0.12, 'skirt'], [0.06, 'tights']]);
    pants = pick(JEANS);
    style = share<Hair>([[0.33, 'short'], [0.25, 'long'], [0.12, 'pony'], [0.05, 'bun'], [0.1, 'cap'], [0.12, 'beanie'], [0.03, 'bald']]);
    if (r() < 0.25) pack = pick(PACKS);
    if (r() < 0.22) hem = { col: top.clone().multiplyScalar(0.8), len: 0.34 };
  } else if (kind === 'city') {
    const suit = r() < 0.3;
    top = pick(suit ? SUITS : COATS);
    sleeve = 'long';
    bottom = share<Bottom>([[0.74, 'long'], [0.2, 'skirt'], [0.06, 'tights']]);
    pants = pick(suit ? SUITS : JEANS);
    style = share<Hair>([[0.38, 'short'], [0.3, 'long'], [0.1, 'pony'], [0.06, 'bun'], [0.06, 'cap'], [0.07, 'beanie'], [0.03, 'bald']]);
    if (r() < 0.2) pack = pick(PACKS);
    if (r() < 0.5) hem = { col: top.clone(), len: 0.5 };
    if (bottom === 'skirt') legs = r() < 0.6 ? dark : skin;
  } else {
    // a summer beach: shirtless, tank tops, tees, shorts, sundresses and sunhats
    const bare = r() < 0.12;
    top = bare ? skin : pick(BEACH_TOPS);
    sleeve = bare ? 'none' : share<Look['sleeve']>([[0.35, 'none'], [0.55, 'short'], [0.1, 'long']]);
    bottom = share<Bottom>([[0.62, 'shorts'], [0.14, 'long'], [0.18, 'skirt'], [0.06, 'tights']]);
    pants = pick(BEACH_SHORTS);
    style = share<Hair>([[0.28, 'short'], [0.2, 'long'], [0.12, 'pony'], [0.06, 'bun'], [0.2, 'cap'], [0.12, 'sunhat'], [0.02, 'bald']]);
    if (r() < 0.14) pack = pick(PACKS);
    if (bottom === 'skirt' && !bare) hem = { col: pick(BEACH_TOPS), len: 0.42 };
  }
  if (bottom === 'skirt' && !hem) hem = { col: pants.clone(), len: 0.4 };
  if (bottom === 'skirt' && kind === 'walk') legs = r() < 0.5 ? dark : skin;
  if (bottom === 'tights') legs = pants;
  return { kind, top, sleeve, bottom, pants, legs, shoe, skin, hair, style, hat, hem, pack, h, w };
}

interface Raw {
  /** Torso shell without the arms, one arm per side (body cloth), the head and neck, the hands per side. */
  torso: THREE.BufferGeometry;
  armL: THREE.BufferGeometry;
  armR: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  handL: THREE.BufferGeometry;
  handR: THREE.BufferGeometry;
  hair: THREE.BufferGeometry;
  pack: THREE.BufferGeometry;
  pantsL: THREE.BufferGeometry;
  pantsR: THREE.BufferGeometry;
  bootL: THREE.BufferGeometry;
  bootR: THREE.BufferGeometry;
}

/** Paint a geometry with one colour (non-indexed, position, normal and colour only), moved down by `dy`. */
function paint(g: THREE.BufferGeometry, c: THREE.Color, dy = 0): THREE.BufferGeometry {
  const src = g.index ? g.toNonIndexed() : g;
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', src.getAttribute('position').clone());
  out.setAttribute('normal', src.getAttribute('normal').clone());
  const n = src.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(col, i * 3);
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (dy) out.translate(0, dy, 0);
  return out;
}

/** Keep the triangles of a non-indexed geometry for which `keep` (given the nine coordinates) says yes. */
function pick(g: THREE.BufferGeometry, keep: (v: number[]) => boolean): THREE.BufferGeometry {
  const p = g.getAttribute('position'), nrm = g.getAttribute('normal');
  const pos: number[] = [], nn: number[] = [];
  const v = new Array<number>(9);
  for (let i = 0; i + 2 < p.count; i += 3) {
    for (let k = 0; k < 3; k++) {
      v[k * 3] = p.getX(i + k);
      v[k * 3 + 1] = p.getY(i + k);
      v[k * 3 + 2] = p.getZ(i + k);
    }
    if (!keep(v)) continue;
    for (let k = 0; k < 3; k++) {
      pos.push(p.getX(i + k), p.getY(i + k), p.getZ(i + k));
      nn.push(nrm.getX(i + k), nrm.getY(i + k), nrm.getZ(i + k));
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nn, 3));
  return out;
}

const cx = (v: number[]) => (v[0] + v[3] + v[6]) / 3;
const cy = (v: number[]) => (v[1] + v[4] + v[7]) / 3;

/** Cut a non-indexed geometry at height y: [the part below, the part above] (triangles are split, so a hem or a sleeve end is a clean line). */
function splitY(g: THREE.BufferGeometry, y: number): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const p = g.getAttribute('position'), nrm = g.getAttribute('normal');
  const out: [number[], number[]][] = [[[], []], [[], []]];
  type Vert = { p: number[]; n: number[] };
  const clip = (poly: Vert[], above: boolean): Vert[] => {
    const res: Vert[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const da = a.p[1] - y, db = b.p[1] - y;
      const ina = above ? da >= 0 : da <= 0, inb = above ? db >= 0 : db <= 0;
      if (ina) res.push(a);
      if (ina !== inb) {
        const t = da / (da - db);
        res.push({ p: a.p.map((x, k) => x + (b.p[k] - x) * t), n: a.n.map((x, k) => x + (b.n[k] - x) * t) });
      }
    }
    return res;
  };
  for (let i = 0; i + 2 < p.count; i += 3) {
    const tri: Vert[] = [0, 1, 2].map((k) => ({ p: [p.getX(i + k), p.getY(i + k), p.getZ(i + k)], n: [nrm.getX(i + k), nrm.getY(i + k), nrm.getZ(i + k)] }));
    [false, true].forEach((above, side) => {
      const poly = clip(tri, above);
      for (let k = 1; k + 1 < poly.length; k++) {
        for (const q of [poly[0], poly[k], poly[k + 1]]) {
          out[side][0].push(...q.p);
          out[side][1].push(...q.n);
        }
      }
    });
  }
  const mk = ([pos, nn]: [number[], number[]]) => {
    const o = new THREE.BufferGeometry();
    o.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    o.setAttribute('normal', new THREE.Float32BufferAttribute(nn, 3));
    return o;
  };
  return [mk(out[0]), mk(out[1])];
}

/** Rotate a geometry about the X axis through (y0, z = 0): bends a forearm at the elbow or a shin at the knee. */
function bendAt(g: THREE.BufferGeometry, y0: number, ang: number): THREE.BufferGeometry {
  if (!ang) return g;
  return g.clone().translate(0, -y0, 0).rotateX(ang).translate(0, y0, 0);
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

/** A person made of rigid pieces hinged at the shoulders, hips and (for runners) knees: torso with arms, two legs. */
export class Person extends THREE.Group {
  readonly torso = new THREE.Group();
  readonly armL = new THREE.Group();
  readonly armR = new THREE.Group();
  readonly legL = new THREE.Group();
  readonly legR = new THREE.Group();
  readonly shinL: THREE.Group | null;
  readonly shinR: THREE.Group | null;
  /** A one-piece stand-in for when the person is far away: seven draw calls for a speck are too many. */
  far: THREE.Mesh | null = null;
  private away = false;

  constructor(m: { torso: THREE.Mesh; armL: THREE.Mesh; armR: THREE.Mesh; legL: THREE.Mesh; legR: THREE.Mesh; shinL?: THREE.Mesh; shinR?: THREE.Mesh }) {
    super();
    this.torso.position.y = HIP;
    this.torso.add(m.torso);
    this.armL.position.set(-SHOULDER_X, SHOULDER_Y - HIP, 0);
    this.armR.position.set(SHOULDER_X, SHOULDER_Y - HIP, 0);
    this.armL.add(m.armL);
    this.armR.add(m.armR);
    this.torso.add(this.armL, this.armR);
    this.legL.position.y = this.legR.position.y = HIP;
    this.legL.add(m.legL);
    this.legR.add(m.legR);
    this.shinL = m.shinL ? new THREE.Group() : null;
    this.shinR = m.shinR ? new THREE.Group() : null;
    if (this.shinL && m.shinL) {
      this.shinL.position.y = KNEE - HIP;
      this.shinL.add(m.shinL);
      this.legL.add(this.shinL);
    }
    if (this.shinR && m.shinR) {
      this.shinR.position.y = KNEE - HIP;
      this.shinR.add(m.shinR);
      this.legR.add(this.shinR);
    }
    this.add(this.torso, this.legL, this.legR);
  }

  /** Swap the jointed figure for its stand-in (or back): beyond ~100 m no one sees the legs move. */
  setFar(far: boolean) {
    if (!this.far || far === this.away) return;
    this.away = far;
    this.far.visible = far;
    this.torso.visible = this.legL.visible = this.legR.visible = !far;
  }

  get isFar() {
    return this.away;
  }

  /** Stride at `phase` (rad): legs and arms swing against each other, runners lean into it and bend the knee. */
  gait(phase: number, run: boolean) {
    const a = run ? 0.85 : 0.42, aa = run ? 0.85 : 0.4;
    const s = Math.sin(phase);
    this.legL.rotation.x = s * a;
    this.legR.rotation.x = -s * a;
    this.armL.rotation.x = -s * aa;
    this.armR.rotation.x = s * aa;
    this.torso.rotation.x = run ? -0.2 - 0.03 * Math.cos(phase * 2) : -0.04;
    if (this.shinL && this.shinR) {
      // the knee folds while the leg swings forward and nearly straightens under the body
      const k = (c: number) => -(0.25 + 1.05 * Math.max(0, c));
      this.shinL.rotation.x = k(Math.cos(phase));
      this.shinR.rotation.x = k(-Math.cos(phase));
    }
  }

  /** Legs on the pedals of a pedicab (the leg meshes already carry a bent knee). */
  pedal(phase: number) {
    this.legL.rotation.x = 1.0 + Math.sin(phase) * 0.45;
    this.legR.rotation.x = 1.0 - Math.sin(phase) * 0.45;
  }

  /** Standing about: a little weight on one leg, arms not quite level. */
  stand(seed: number) {
    const q = Math.sin(seed * 12.9898) * 0.5;
    this.legL.rotation.x = 0.1 * q;
    this.legR.rotation.x = -0.1 * q;
    this.armL.rotation.x = 0.1 * q;
    this.armR.rotation.x = -0.1 * q;
    this.armL.rotation.z = 0.04;
    this.armR.rotation.z = -0.04;
    this.torso.rotation.x = 0.02 * q;
  }

  /** Sat down, on a bench (thighs forward, shins down) or on the ground (legs stretched out). */
  sit(pose: 'bench' | 'ground', lean: number) {
    const bench = pose === 'bench';
    this.legL.rotation.x = this.legR.rotation.x = bench ? 1.2 : 1.4;
    this.legL.rotation.z = bench ? -0.07 : -0.14;
    this.legR.rotation.z = bench ? 0.07 : 0.14;
    if (this.shinL && this.shinR) this.shinL.rotation.x = this.shinR.rotation.x = bench ? -1.1 : -0.15;
    this.armL.rotation.x = this.armR.rotation.x = bench ? 0.5 : 0.3;
    this.torso.rotation.x = lean;
  }
}

export class PersonKit {
  private raw: Raw;
  private looks: Look[] = [];
  private byKind: Record<LookKind, number[]> = { run: [], walk: [], city: [], beach: [] };
  private cache = new Map<string, THREE.BufferGeometry>();
  private mat = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 }), { key: 'parkperson' });
  readonly material = this.mat;

  private constructor(raw: Raw, seed = 31) {
    this.raw = raw;
    const r = rng(seed);
    const sizes: [LookKind, number][] = [['run', 44], ['walk', 44], ['city', 36], ['beach', 36]];
    for (const [kind, n] of sizes) {
      for (let i = 0; i < n; i++) {
        this.byKind[kind].push(this.looks.length);
        this.looks.push(makeLook(kind, r));
      }
    }
  }

  static async load(): Promise<PersonKit> {
    const src = await loadModel('person-stand.glb');
    src.updateMatrixWorld(true);
    const by: Record<string, THREE.BufferGeometry> = {};
    src.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      g.applyMatrix4(m.matrixWorld);
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
      g = g.index ? g.toNonIndexed() : g;
      by[(m.material as THREE.Material).name] = g;
    });
    const L = (v: number[]) => cx(v) < 0, R = (v: number[]) => cx(v) >= 0;
    // the body cloth is a torso box (rings at 1.03 and 1.47) with an arm on each side (rings at 1.43, 1.17 and 0.93)
    const ring = (v: number[]) => [1, 4, 7].some((i) => Math.abs(v[i] - 1.03) < 0.02 || Math.abs(v[i] - 1.47) < 0.02);
    const torso = pick(by.person_body, ring);
    const arms = pick(by.person_body, (v) => !ring(v));
    return new PersonKit({
      torso, armL: pick(arms, L), armR: pick(arms, R),
      head: pick(by.person_skin, (v) => cy(v) > 1.3), handL: pick(pick(by.person_skin, (v) => cy(v) < 1.3), L), handR: pick(pick(by.person_skin, (v) => cy(v) < 1.3), R),
      hair: by.person_hair, pack: by.person_pack,
      pantsL: pick(by.person_pants, L), pantsR: pick(by.person_pants, R), bootL: pick(by.person_boot, L), bootR: pick(by.person_boot, R),
    });
  }

  /** A look of this kind for whoever is being placed (callers pass their own generator so a spot's crowd is repeatable). */
  look(kind: LookKind, r: () => number): number {
    const l = this.byKind[kind];
    return l[Math.floor(r() * l.length)];
  }

  private memo(key: string, make: () => THREE.BufferGeometry) {
    let g = this.cache.get(key);
    if (!g) this.cache.set(key, (g = make()));
    return g;
  }

  /** Trunk, head, hair or hat, and the hem of a coat or skirt, with the hips at the origin. */
  private torsoGeo(i: number) {
    return this.memo(`t${i}`, () => {
      const lk = this.looks[i], r = this.raw;
      const parts = [paint(r.torso, lk.top), paint(r.head, lk.skin)];
      const hair = (g: THREE.BufferGeometry) => parts.push(paint(g, lk.hair));
      const hat = (g: THREE.BufferGeometry) => parts.push(paint(g, lk.hat));
      if (lk.style !== 'bald') parts.push(paint(r.hair, lk.hair));
      if (lk.style === 'long') {
        hair(box(0.215, 0.32, 0.05, 0, 1.6, 0.095));
        hair(box(0.03, 0.2, 0.12, 0.1, 1.63, 0.01));
        hair(box(0.03, 0.2, 0.12, -0.1, 1.63, 0.01));
      } else if (lk.style === 'pony') {
        hair(box(0.2, 0.1, 0.04, 0, 1.68, 0.085));
        hair(box(0.045, 0.22, 0.05, 0, 1.6, 0.14).rotateX(-0.3));
      } else if (lk.style === 'bun') {
        hair(new THREE.SphereGeometry(0.055, 7, 5).translate(0, 1.8, 0.05));
      } else if (lk.style === 'cap') {
        hat(box(0.22, 0.09, 0.23, 0, 1.79, -0.005));
        hat(box(0.17, 0.018, 0.12, 0, 1.755, -0.15));
      } else if (lk.style === 'beanie') {
        hat(new THREE.SphereGeometry(1, 9, 6).scale(0.118, 0.1, 0.125).translate(0, 1.745, 0));
      } else if (lk.style === 'sunhat') {
        hat(new THREE.CylinderGeometry(0.235, 0.235, 0.012, 14).translate(0, 1.765, 0));
        hat(new THREE.CylinderGeometry(0.105, 0.115, 0.07, 12).translate(0, 1.8, 0));
      }
      if (lk.hem) {
        const len = lk.hem.len;
        parts.push(paint(new THREE.CylinderGeometry(0.21, 0.21 + len * 0.2, len, 12, 1, true).scale(1, 1, 0.95).translate(0, 1.05 - len / 2, -0.01), lk.hem.col));
      }
      if (lk.pack) parts.push(paint(r.pack, lk.pack));
      return mergeGeometries(parts)!.translate(0, -HIP, 0);
    });
  }

  /** One arm, hinged at the shoulder (origin), with the forearm bent forward by `bend`. */
  private armGeo(i: number, side: -1 | 1, bend: number) {
    return this.memo(`a${i}:${side}:${bend}`, () => {
      const lk = this.looks[i], r = this.raw;
      const [fore, upper] = splitY(side < 0 ? r.armL : r.armR, ELBOW);
      const up: THREE.BufferGeometry[] = [];
      if (lk.sleeve === 'long') up.push(paint(upper, lk.top));
      else {
        const [lo, hi] = splitY(upper, lk.sleeve === 'short' ? 1.3 : 1.4);
        up.push(paint(hi, lk.top), paint(lo, lk.skin));
      }
      const long = lk.sleeve === 'long';
      const lower = [paint(fore, long ? lk.top : lk.skin), paint(side < 0 ? r.handL : r.handR, lk.skin)];
      const lowerBent = bendAt(mergeGeometries(lower)!, ELBOW, bend);
      const joint = paint(new THREE.SphereGeometry(0.05, 6, 4).translate(side * 0.24, ELBOW, 0), long ? lk.top : lk.skin);
      return mergeGeometries([...up, lowerBent, joint])!.translate(-side * SHOULDER_X, -SHOULDER_Y, 0);
    });
  }

  /** A leg in absolute coordinates: thigh (hip to knee) and shin with shoe (knee down), clothed by the look. */
  private legParts(i: number, side: -1 | 1): [THREE.BufferGeometry, THREE.BufferGeometry] {
    const lk = this.looks[i], r = this.raw;
    const key = `lp${i}:${side}`;
    const hit = this.cache.get(key + 't');
    if (hit) return [hit, this.cache.get(key + 's')!];
    const pants = side < 0 ? r.pantsL : r.pantsR;
    const dress = (g: THREE.BufferGeometry) => {
      if (lk.bottom === 'long' || lk.bottom === 'tights') return paint(g, lk.pants);
      if (lk.bottom === 'skirt') return paint(g, lk.legs);
      const [lo, hi] = splitY(g, 0.74);
      return mergeGeometries([paint(hi, lk.pants), paint(lo, lk.legs)])!;
    };
    const thigh = dress(pick(pants, (v) => cy(v) >= KNEE));
    const kneeCol = lk.bottom === 'long' || lk.bottom === 'tights' ? lk.pants : lk.legs;
    const shin = mergeGeometries([
      dress(pick(pants, (v) => cy(v) < KNEE)), paint(side < 0 ? r.bootL : r.bootR, lk.shoe),
      paint(new THREE.SphereGeometry(0.062, 6, 4).translate(side * 0.1, KNEE, 0), kneeCol),
    ])!;
    this.cache.set(key + 't', thigh);
    this.cache.set(key + 's', shin);
    return [thigh, shin];
  }

  /** A whole leg hinged at the hip (origin) with the knee bent by `bend` (negative folds the shin back). */
  private legGeo(i: number, side: -1 | 1, bend: number) {
    return this.memo(`l${i}:${side}:${bend}`, () => {
      const [thigh, shin] = this.legParts(i, side);
      return mergeGeometries([thigh, bendAt(shin, KNEE, bend)])!.translate(0, -HIP, 0);
    });
  }

  private mesh(g: THREE.BufferGeometry, shadow = true) {
    const m = new THREE.Mesh(g, this.mat);
    m.castShadow = shadow;
    return m;
  }

  private assemble(look: number, armBend: number, legBend: number, split: boolean): Person {
    const legs = ([-1, 1] as const).map((sd) => {
      if (!split) return { leg: this.mesh(this.legGeo(look, sd, legBend)), shin: undefined };
      const [thigh, shin] = this.legParts(look, sd);
      const th = this.memo(`th${look}:${sd}`, () => thigh.clone().translate(0, -HIP, 0));
      const sh = this.memo(`sh${look}:${sd}`, () => shin.clone().translate(0, -KNEE, 0));
      return { leg: this.mesh(th), shin: this.mesh(sh, false) };
    });
    return new Person({
      torso: this.mesh(this.torsoGeo(look)),
      armL: this.mesh(this.armGeo(look, -1, armBend), false), armR: this.mesh(this.armGeo(look, 1, armBend), false),
      legL: legs[0].leg, legR: legs[1].leg, shinL: legs[0].shin, shinR: legs[1].shin,
    });
  }

  /**
   * A person who moves, in the look `look`. Walkers are five pieces (torso, two arms, two legs with a straight
   * knee); runners also fold their knees and bend their elbows (seven); a pedicab rider's knees are already bent.
   */
  rigged(look: number, scale = 1, mode: 'walk' | 'run' | 'pedal' = 'walk'): Person {
    const lk = this.looks[look];
    const p = mode === 'run' ? this.assemble(look, 1.45, 0, true) : this.assemble(look, 0.25, mode === 'pedal' ? -1.05 : 0, false);
    p.scale.set(scale * lk.w, scale * lk.h, scale * lk.w);
    if (mode !== 'pedal') {
      // the stand-in is the figure caught mid-stride
      const run = mode === 'run';
      const far = new THREE.Mesh(this.baked(`${run ? 'fr' : 'fw'}${look}`, look, run ? 1.45 : 0.25, (q) => q.gait(0.9, run)), this.mat);
      far.visible = false;
      p.far = far;
      p.add(far);
    }
    return p;
  }

  /** The pose of a person as one merged mesh (1 draw call), feet or seat where the figure's origin is. */
  private baked(key: string, look: number, armBend: number, pose: (p: Person) => void) {
    return this.memo(key, () => {
      const p = this.assemble(look, armBend, 0, true);
      pose(p);
      p.updateMatrixWorld(true);
      const gs: THREE.BufferGeometry[] = [];
      p.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) gs.push(m.geometry.clone().applyMatrix4(m.matrixWorld));
      });
      return mergeGeometries(gs)!;
    });
  }

  private place(g: THREE.BufferGeometry, look: number, scale: number) {
    const lk = this.looks[look];
    const m = new THREE.Mesh(g, this.mat);
    m.castShadow = true;
    m.scale.set(scale * lk.w, scale * lk.h, scale * lk.w);
    return m;
  }

  /** One merged mesh (1 draw call) for someone who just stands. */
  standing(look: number, scale = 1): THREE.Mesh {
    return this.place(this.baked(`st${look}`, look, 0.2, (p) => p.stand(look)), look, scale);
  }

  /** One merged mesh for someone sitting on a bench (knees bent, hands in the lap) or on the ground (legs out). */
  seated(look: number, scale = 1, pose: 'bench' | 'ground' = 'bench', lean = 0.1): THREE.Mesh {
    const l = Math.round(lean * 20) / 20;
    return this.place(this.baked(`se${look}:${pose}:${l}`, look, 0.9, (p) => p.sit(pose, l)), look, scale);
  }
}


function merged(parts: [THREE.BufferGeometry, THREE.Color][]): THREE.BufferGeometry {
  return mergeGeometries(parts.map(([g, c]) => paint(g.index ? g.toNonIndexed() : g, c)))!;
}

let accessoryMat: THREE.MeshStandardMaterial | null = null;
/** Vertex-coloured material shared by dogs, strollers and the like; freed with the world that holds it. */
export function accessoryMaterial() {
  return (accessoryMat ??= markShared(patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.05 }), { key: 'parkacc' })));
}

/** A medium dog trotting along -Z: body, head, snout, ears, four legs, tail. */
export function dogGeometry(coat: string, dark: string): THREE.BufferGeometry {
  const c = new THREE.Color(coat), d = new THREE.Color(dark);
  return merged([
    [box(0.24, 0.26, 0.62, 0, 0.5, 0), c],
    [box(0.2, 0.2, 0.22, 0, 0.66, -0.4), c],
    [box(0.12, 0.1, 0.14, 0, 0.62, -0.55), d],
    [box(0.06, 0.12, 0.05, 0.08, 0.78, -0.35), d],
    [box(0.06, 0.12, 0.05, -0.08, 0.78, -0.35), d],
    [box(0.07, 0.38, 0.07, 0.08, 0.19, -0.22), c],
    [box(0.07, 0.38, 0.07, -0.08, 0.19, -0.22), c],
    [box(0.07, 0.38, 0.07, 0.08, 0.19, 0.24), c],
    [box(0.07, 0.38, 0.07, -0.08, 0.19, 0.24), c],
    [box(0.05, 0.05, 0.3, 0, 0.62, 0.42).rotateX(0.5), c],
  ]);
}

/** A pushchair seen from behind: frame, hood, canvas body, four wheels, handle. Front toward -Z. */
export function strollerGeometry(canvas: string): THREE.BufferGeometry {
  const c = new THREE.Color(canvas), frame = new THREE.Color(0.06, 0.06, 0.07), hood = c.clone().multiplyScalar(0.8);
  const wheel = (x: number, z: number, r: number) => new THREE.CylinderGeometry(r, r, 0.04, 10).rotateZ(Math.PI / 2).translate(x, r, z);
  return merged([
    [box(0.46, 0.2, 0.7, 0, 0.5, -0.08), c],
    [box(0.46, 0.3, 0.05, 0, 0.7, 0.26).rotateX(-0.35), c],
    [new THREE.SphereGeometry(0.26, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.9, 1.1).rotateX(-0.2).translate(0, 0.65, 0.05), hood],
    [box(0.04, 0.05, 0.8, 0.22, 0.32, -0.05), frame],
    [box(0.04, 0.05, 0.8, -0.22, 0.32, -0.05), frame],
    [box(0.5, 0.04, 0.04, 0, 0.98, 0.42), frame],
    [box(0.04, 0.6, 0.04, 0.22, 0.7, 0.4).rotateX(-0.3), frame],
    [box(0.04, 0.6, 0.04, -0.22, 0.7, 0.4).rotateX(-0.3), frame],
    [wheel(0.26, 0.32, 0.14), frame], [wheel(-0.26, 0.32, 0.14), frame],
    [wheel(0.26, -0.34, 0.1), frame], [wheel(-0.26, -0.34, 0.1), frame],
  ]);
}

/** A pedicab seen side-on moving along -Z: bicycle in front, passenger bench and canopy behind. */
export function pedicabGeometry(body: string, canopy: string): THREE.BufferGeometry {
  const b = new THREE.Color(body), cp = new THREE.Color(canopy), frame = new THREE.Color(0.07, 0.07, 0.08), seat = new THREE.Color(0.12, 0.1, 0.1);
  const wheel = (x: number, z: number, r: number) => new THREE.CylinderGeometry(r, r, 0.05, 14).rotateZ(Math.PI / 2).translate(x, r, z);
  return merged([
    [wheel(0, -1.5, 0.34), frame],
    [wheel(0.62, 0.15, 0.34), frame], [wheel(-0.62, 0.15, 0.34), frame],
    [box(0.05, 0.05, 1.5, 0, 0.62, -0.78).rotateX(0.15), frame],
    [box(0.4, 0.06, 0.2, 0, 0.82, -1.0), seat],
    [box(0.5, 0.05, 0.05, 0, 1.0, -1.5), frame],
    [box(1.35, 0.1, 1.05, 0, 0.5, 0.45), b],
    [box(1.2, 0.34, 0.06, 0, 0.78, 0.98), b],
    [box(1.0, 0.12, 0.72, 0, 0.62, 0.45), seat],
    [box(0.05, 1.0, 0.05, 0.64, 1.1, 0.0), frame], [box(0.05, 1.0, 0.05, -0.64, 1.1, 0.0), frame],
    [box(0.05, 1.0, 0.05, 0.64, 1.1, 0.95), frame], [box(0.05, 1.0, 0.05, -0.64, 1.1, 0.95), frame],
    [box(1.5, 0.06, 1.25, 0, 1.64, 0.48), cp],
  ]);
}

/** A thin leash from a hand to a collar, in the frame of whatever it is added to. */
export function leashGeometry(a: THREE.Vector3, b: THREE.Vector3): THREE.BufferGeometry {
  const d = b.clone().sub(a);
  const g = new THREE.BoxGeometry(0.015, 0.015, d.length());
  g.applyMatrix4(new THREE.Matrix4().lookAt(new THREE.Vector3(), d, new THREE.Vector3(0, 1, 0)));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return merged([[g, new THREE.Color(0.35, 0.05, 0.05)]]);
}

/** A beach towel or picnic rug lying flat: a coloured slab with a pale stripe, centred, 0.8 × 1.8 m. */
export function towelGeometry(colour: string, stripe: string): THREE.BufferGeometry {
  const c = new THREE.Color(colour), s = new THREE.Color(stripe);
  return merged([
    [box(0.85, 0.02, 1.8, 0, 0.012, 0), c],
    [box(0.85, 0.022, 0.16, 0, 0.013, -0.45), s],
    [box(0.85, 0.022, 0.16, 0, 0.013, 0.45), s],
  ]);
}

/** A surfboard standing on its tail in the sand: a flat ellipsoid, 2.1 m tall, with a stripe down the middle. */
export function surfboardGeometry(colour: string, stripe: string): THREE.BufferGeometry {
  const c = new THREE.Color(colour), s = new THREE.Color(stripe);
  const body = new THREE.SphereGeometry(1, 12, 10).scale(0.27, 1.05, 0.04).translate(0, 1.0, 0);
  const rail = new THREE.SphereGeometry(1, 8, 8).scale(0.04, 0.95, 0.045).translate(0, 1.02, 0);
  return merged([[body, c], [rail, s]]);
}

/** A taxi's roof sign: a pale lit box on a short foot, centred on the origin (set it on the roof of a car 1.48 m tall). */
export function taxiSignGeometry(): THREE.BufferGeometry {
  return merged([
    [box(0.16, 0.05, 0.08, 0, 0.025, 0), new THREE.Color(0.1, 0.1, 0.11)],
    [box(0.5, 0.15, 0.17, 0, 0.125, 0), new THREE.Color('#f4d35e')],
  ]);
}
