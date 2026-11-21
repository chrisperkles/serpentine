// People and their companions for a city park: one scanned-style figure (person-stand.glb) split at the hips
// into a torso and two legs so it can run, walk, stand or sit, a small look pool shared by everyone so
// geometry stays cheap, and dogs and strollers built from boxes.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { patchMaterial } from './atmosphere.ts';
import { markShared } from './dispose.ts';
import { loadModel } from './Landmarks.ts';

/** Height of the hip joint above the soles in the source model (m). */
const HIP = 0.9;

const TOPS = ['#c0392b', '#f1f1ee', '#2e86de', '#f1c40f', '#1b1d20', '#8e44ad', '#7f8c8d', '#16a085', '#ff5d8f', '#34495e', '#9be15d', '#ff7b00', '#d9d4c7', '#3f6b4f'];
const PANTS = ['#16181b', '#26303f', '#3a3b3f', '#6b4f3a', '#d9d4c7', '#1d2a4a', '#2c4a38'];
const SKINS = ['#a6704f', '#d9a381', '#6f4630', '#efc9a8'];
const HAIRS = ['#0d0805', '#3a2616', '#7a5230', '#b99a63', '#7d7d7f'];
const PACKS = ['#1b3a2a', '#1a1c20', '#8c2a1e', '#2d4a6b'];

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

interface Look {
  top: THREE.Color;
  pants: THREE.Color;
  skin: THREE.Color;
  hair: THREE.Color;
  pack: THREE.Color | null;
}

interface Raw {
  body: THREE.BufferGeometry;
  skin: THREE.BufferGeometry;
  hair: THREE.BufferGeometry;
  pack: THREE.BufferGeometry;
  pantsL: THREE.BufferGeometry;
  pantsR: THREE.BufferGeometry;
  bootL: THREE.BufferGeometry;
  bootR: THREE.BufferGeometry;
}

function paint(g: THREE.BufferGeometry, c: THREE.Color, dy = 0): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', g.getAttribute('position').clone());
  out.setAttribute('normal', g.getAttribute('normal').clone());
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(col, i * 3);
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (dy) out.translate(0, dy, 0);
  return out;
}

/** Keep the triangles of a non-indexed geometry whose centroid satisfies `keep`. */
function pick(g: THREE.BufferGeometry, keep: (x: number) => boolean): THREE.BufferGeometry {
  const p = g.getAttribute('position'), nrm = g.getAttribute('normal');
  const pos: number[] = [], nn: number[] = [];
  for (let i = 0; i + 2 < p.count; i += 3) {
    const cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3;
    if (!keep(cx)) continue;
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

/** A walking, running, standing or sitting person: torso and legs hinge at the hips. */
export class Person extends THREE.Group {
  readonly torso: THREE.Group;
  readonly legL: THREE.Object3D;
  readonly legR: THREE.Object3D;

  constructor(torso: THREE.Mesh, legL: THREE.Mesh, legR: THREE.Mesh) {
    super();
    this.torso = new THREE.Group();
    this.torso.position.y = HIP;
    this.torso.add(torso);
    this.legL = new THREE.Group();
    this.legL.position.y = HIP;
    this.legL.add(legL);
    this.legR = new THREE.Group();
    this.legR.position.y = HIP;
    this.legR.add(legR);
    this.add(this.torso, this.legL, this.legR);
  }

  /** Stride at `phase` (rad): legs swing against each other, runners lean into it. */
  gait(phase: number, run: boolean) {
    const a = run ? 0.85 : 0.42;
    const s = Math.sin(phase);
    this.legL.rotation.x = s * a;
    this.legR.rotation.x = -s * a;
    this.torso.rotation.x = run ? -0.2 - 0.03 * Math.cos(phase * 2) : -0.04;
  }

  /** Sat down: thighs forward, back against the bench. */
  sit(lean = 0.1) {
    this.legL.rotation.x = this.legR.rotation.x = 1.15;
    this.legL.rotation.z = -0.06;
    this.legR.rotation.z = 0.06;
    this.torso.rotation.x = lean;
  }
}

export class PersonKit {
  private raw: Raw;
  private looks: Look[] = [];
  private mat = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 }), { key: 'parkperson' });
  private legCache = new Map<number, [THREE.BufferGeometry, THREE.BufferGeometry]>();
  private upperCache = new Map<number, THREE.BufferGeometry>();
  private staticCache = new Map<number, THREE.BufferGeometry>();
  readonly material = this.mat;

  private constructor(raw: Raw, seed = 31) {
    this.raw = raw;
    const r = rng(seed);
    const col = (a: string[]) => new THREE.Color(a[Math.floor(r() * a.length)]);
    for (let i = 0; i < 40; i++) {
      this.looks.push({
        top: new THREE.Color(TOPS[i % TOPS.length]), pants: col(PANTS), skin: col(SKINS), hair: col(HAIRS),
        pack: r() < 0.3 ? col(PACKS) : null,
      });
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
    const L = (x: number) => x < 0, R = (x: number) => x >= 0;
    return new PersonKit({
      body: by.person_body, skin: by.person_skin, hair: by.person_hair, pack: by.person_pack,
      pantsL: pick(by.person_pants, L), pantsR: pick(by.person_pants, R), bootL: pick(by.person_boot, L), bootR: pick(by.person_boot, R),
    });
  }

  /** How many different looks there are (callers pick one by index). */
  get count() {
    return this.looks.length;
  }

  private legs(pants: number): [THREE.BufferGeometry, THREE.BufferGeometry] {
    let l = this.legCache.get(pants);
    if (!l) {
      const c = this.looks[pants].pants, boot = new THREE.Color(0.05, 0.05, 0.055);
      const mk = (p: THREE.BufferGeometry, b: THREE.BufferGeometry) => mergeGeometries([paint(p, c, -HIP), paint(b, boot, -HIP)])!;
      l = [mk(this.raw.pantsL, this.raw.bootL), mk(this.raw.pantsR, this.raw.bootR)];
      this.legCache.set(pants, l);
    }
    return l;
  }

  private upper(look: number, dy: number): THREE.BufferGeometry {
    const key = look * 2 + (dy ? 1 : 0);
    let g = this.upperCache.get(key);
    if (!g) {
      const lk = this.looks[look], r = this.raw;
      const parts = [paint(r.body, lk.top, dy), paint(r.skin, lk.skin, dy), paint(r.hair, lk.hair, dy)];
      if (lk.pack) parts.push(paint(r.pack, lk.pack, dy));
      g = mergeGeometries(parts)!;
      this.upperCache.set(key, g);
    }
    return g;
  }

  /** Rigged person (3 draw calls) for anyone who moves or sits. `look` picks clothes and skin. */
  rigged(look: number, scale = 1): Person {
    const [l, r] = this.legs(look);
    const mk = (g: THREE.BufferGeometry) => {
      const m = new THREE.Mesh(g, this.mat);
      m.castShadow = true;
      return m;
    };
    const p = new Person(mk(this.upper(look, -HIP)), mk(l), mk(r));
    p.scale.setScalar(scale);
    return p;
  }

  /** One merged mesh (1 draw call) for someone who just stands. */
  standing(look: number, scale = 1): THREE.Mesh {
    let g = this.staticCache.get(look);
    if (!g) {
      const [l, r] = this.legs(look);
      g = mergeGeometries([this.upper(look, 0), l.clone().translate(0, HIP, 0), r.clone().translate(0, HIP, 0)])!;
      this.staticCache.set(look, g);
    }
    const m = new THREE.Mesh(g, this.mat);
    m.castShadow = true;
    m.scale.setScalar(scale);
    return m;
  }
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

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
