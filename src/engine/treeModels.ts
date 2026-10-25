// Card-based tree models (near LOD) on a photographic foliage atlas (public/textures/foliage.png,
// composed from CC0 ambientCG / Poly Haven scans by scripts/bake-foliage.py). Foliage texels are
// near-neutral; species and season colour come from per-instance tints (Vegetation.ts).
//
// Norway spruce: whorls of drooping branch cards ("comb" habit) around a dark inner core.
// Beech: leaf-cluster cards in cloud-like clumps on a few visible main limbs.
// Both have height 1 with the base at the origin; crownBase sets where foliage starts
// (high in closed forest, near the ground for open-grown trees).

import * as THREE from 'three';
import { markShared } from './dispose.ts';

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

// atlas regions in UV space (0..1), v up — see scripts/bake-foliage.py
export const REGIONS = {
  branch: { u0: 0, v0: 0.5, u1: 0.5, v1: 1 },
  leaves: { u0: 0.5, v0: 0.5, u1: 1, v1: 1 },
  barkDark: { u0: 0.005, v0: 0.255, u1: 0.245, v1: 0.495 },
  barkLight: { u0: 0.255, v0: 0.255, u1: 0.495, v1: 0.495 },
  grass: { u0: 0.5, v0: 0.25, u1: 1, v1: 0.5 },
  flowers: { u0: 0.5, v0: 0, u1: 1, v1: 0.25 },
};
type Region = typeof REGIONS.branch;

const atlases = new Map<string, { tex: THREE.Texture; ready: Promise<THREE.Texture> }>();

/** The foliage atlas of a biome (default: the Alpine one). */
export function treeAtlas(url = '/textures/foliage.png'): THREE.Texture {
  let a = atlases.get(url);
  if (!a) {
    let done!: (t: THREE.Texture) => void;
    const ready = new Promise<THREE.Texture>((r) => (done = r));
    const tex = new THREE.TextureLoader().load(url, (t) => done(t));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    atlases.set(url, (a = { tex: markShared(tex), ready }));
  }
  return a.tex;
}

/** Resolves once the foliage atlas image has loaded (needed to render impostors). */
export function treeAtlasReady(url = '/textures/foliage.png'): Promise<THREE.Texture> {
  treeAtlas(url);
  return atlases.get(url)!.ready;
}

/**
 * Alpha-tested foliage loses coverage in the mip chain, so distant trees turn into see-through
 * skeletons. Scale alpha up with the mip level (Ben Golus' trick) to keep crowns dense.
 */
export function preserveCoverage<T extends THREE.Material>(mat: T, texSize = 2048, boost = 0.3): T {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    // the per-instance tint is the foliage colour: bark (atlas u < 0.5, v 0.25–0.5) keeps its own colour
    shader.vertexShader = shader.vertexShader.replace(
      '#include <color_vertex>',
      `#include <color_vertex>
#if defined( USE_INSTANCING_COLOR ) && defined( USE_MAP )
if (uv.y > 0.25 && uv.y < 0.5 && uv.x < 0.5) vColor.xyz /= max(instanceColor.xyz, vec3(0.05));
#endif`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <alphatest_fragment>',
      `#ifdef USE_MAP
{
  vec2 tc = vMapUv * ${texSize.toFixed(1)};
  vec2 ddx = dFdx(tc), ddy = dFdy(tc);
  float mip = max(0.0, 0.5 * log2(max(dot(ddx, ddx), dot(ddy, ddy))));
  diffuseColor.a *= 1.0 + mip * ${boost.toFixed(3)};
}
#endif
#include <alphatest_fragment>`,
    );
  };
  return mat;
}

class Builder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];

  quad(p: THREE.Vector3[], n: THREE.Vector3[], reg: Region, ao: number[], flipU = false, vRange: [number, number] = [0, 1]) {
    const b = this.pos.length / 3;
    const v0 = reg.v0 + (reg.v1 - reg.v0) * vRange[0];
    const v1 = reg.v0 + (reg.v1 - reg.v0) * vRange[1];
    const uvs = [
      [reg.u0, v0],
      [reg.u1, v0],
      [reg.u1, v1],
      [reg.u0, v1],
    ];
    for (let i = 0; i < 4; i++) {
      this.pos.push(p[i].x, p[i].y, p[i].z);
      this.nor.push(n[i].x, n[i].y, n[i].z);
      const [u, v] = uvs[i];
      this.uv.push(flipU ? reg.u0 + reg.u1 - u : u, v);
      this.col.push(ao[i], ao[i], ao[i]);
    }
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }

  /** Tapered tube from a to b (bark), UVs wrap the bark region. */
  limb(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, seg: number, reg: Region, ao0: number, ao1: number) {
    const d = b.clone().sub(a);
    const z = d.clone().normalize();
    const x = Math.abs(z.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    x.cross(z).normalize();
    const y = z.clone().cross(x);
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2;
      const a1 = ((k + 1) / seg) * Math.PI * 2;
      const o0 = x.clone().multiplyScalar(Math.cos(a0)).add(y.clone().multiplyScalar(Math.sin(a0)));
      const o1 = x.clone().multiplyScalar(Math.cos(a1)).add(y.clone().multiplyScalar(Math.sin(a1)));
      const p = [
        a.clone().addScaledVector(o0, r0),
        a.clone().addScaledVector(o1, r0),
        b.clone().addScaledVector(o1, r1),
        b.clone().addScaledVector(o0, r1),
      ];
      const sub: Region = {
        u0: reg.u0 + ((reg.u1 - reg.u0) * k) / seg,
        u1: reg.u0 + ((reg.u1 - reg.u0) * (k + 1)) / seg,
        v0: reg.v0,
        v1: reg.v1,
      };
      this.quad(p, [o0, o1, o1, o0], sub, [ao0, ao0, ao1, ao1]);
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const UP = new THREE.Vector3(0, 1, 0);

/** Norway spruce, height 1, crown radius ~0.24 at the crown base. */
export function spruceGeometry(seed = 1, crownBase = 0.35): THREE.BufferGeometry {
  const b = new Builder();
  const r = rng(seed);
  b.limb(new THREE.Vector3(0, -0.05, 0), new THREE.Vector3(0, 0.97, 0), 0.014, 0.003, 7, REGIONS.barkDark, 0.4, 0.7);
  // dark inner core: radial vertical cards close to the trunk fill the gaps between whorls
  for (let j = 0; j < 5; j++) {
    const a = (j / 5) * Math.PI + r() * 0.3;
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    for (let s = 0; s < 3; s++) {
      const y0 = crownBase + ((0.95 - crownBase) * s) / 3;
      const y1 = crownBase + ((0.95 - crownBase) * (s + 1.15)) / 3;
      const w0 = 0.11 * (1 - (y0 - crownBase) / (1 - crownBase)) + 0.02;
      const w1 = 0.11 * (1 - (y1 - crownBase) / (1 - crownBase)) + 0.01;
      const n = new THREE.Vector3(-dir.z, 0.4, dir.x).normalize();
      b.quad(
        [
          dir.clone().multiplyScalar(-w0).setY(y0),
          dir.clone().multiplyScalar(w0).setY(y0),
          dir.clone().multiplyScalar(w1).setY(y1),
          dir.clone().multiplyScalar(-w1).setY(y1),
        ],
        [n, n, n, n],
        REGIONS.branch,
        [0.28, 0.28, 0.4, 0.4],
        s % 2 === 1,
        [0.15, 0.9],
      );
    }
  }
  const whorls = 15;
  for (let k = 0; k < whorls; k++) {
    const rel = (k + r() * 0.4) / whorls; // 0 = crown base, 1 = top
    const y = crownBase + rel * (0.95 - crownBase);
    const len = 0.03 + 0.22 * Math.pow(1 - rel, 0.9);
    const count = rel < 0.3 ? 7 : rel < 0.7 ? 6 : 5;
    const twist = r() * Math.PI * 2;
    for (let j = 0; j < count; j++) {
      const a = twist + (j / count) * Math.PI * 2 + (r() - 0.5) * 0.45;
      const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const side = new THREE.Vector3(-dir.z, 0, dir.x);
      const l = len * (0.75 + r() * 0.5);
      const drop = l * (0.18 + 0.3 * (1 - rel) + r() * 0.18);
      // branches of a whorl are not all at one height
      const by = y + (r() - 0.5) * 0.045;
      const aoIn = 0.32 + 0.25 * rel;
      const aoOut = 0.8 + 0.2 * rel;
      const nOut = dir.clone().setY(0.55).normalize();
      const nIn = dir.clone().multiplyScalar(0.3).setY(0.9).normalize();
      // each branch = an inner and an outer spray, sagging more towards the tip, each with its own roll
      for (const [f0, f1] of [[0.0, 0.62], [0.42, 1.0]] as const) {
        const sag = (f: number) => drop * f * f * 1.1;
        const p0 = new THREE.Vector3(0, by, 0).addScaledVector(dir, 0.01 + l * f0);
        p0.y -= sag(f0);
        const p1 = new THREE.Vector3(0, by, 0).addScaledVector(dir, 0.01 + l * f1);
        p1.y -= sag(f1);
        const segL = l * (f1 - f0);
        const ao0 = aoIn + (aoOut - aoIn) * f0, ao1 = aoIn + (aoOut - aoIn) * f1;
        // hanging curtain of twigs below the branch
        const hgt = segL * 0.9;
        const up = new THREE.Vector3(0, hgt * 0.3, 0);
        const dn = new THREE.Vector3(0, hgt * 0.7, 0);
        const sw = side.clone().multiplyScalar(segL * 0.07 * (r() - 0.5));
        b.quad(
          [p0.clone().sub(dn).add(sw), p1.clone().sub(dn).sub(sw), p1.clone().add(up).sub(sw), p0.clone().add(up).add(sw)],
          [nIn, nOut, nOut, nIn],
          REGIONS.branch,
          [ao0, ao1, ao1, ao0],
          (j + (f0 > 0 ? 1 : 0)) % 2 === 0,
          f0 > 0 ? [0.0, 0.85] : [0.1, 1.0],
        );
        // spray rolled off the horizontal
        const roll = (r() < 0.5 ? 1 : -1) * (0.3 + r() * 0.5);
        const wid = segL * (0.55 + r() * 0.2);
        const fw = side.clone().multiplyScalar(Math.cos(roll) * wid).setY(Math.sin(roll) * wid);
        b.quad(
          [p0.clone().sub(fw), p1.clone().sub(fw), p1.clone().add(fw), p0.clone().add(fw)],
          [nIn, nOut, nOut, nIn],
          REGIONS.branch,
          [ao0 * 0.95, ao1, ao1, ao0 * 0.95],
          (j + (f0 > 0 ? 0 : 1)) % 2 === 1,
          [0.12, 0.88],
        );
      }
    }
  }
  // leader shoot
  for (let j = 0; j < 2; j++) {
    const a = (j / 2) * Math.PI;
    const d = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(0.035);
    b.quad(
      [new THREE.Vector3(-d.x, 0.9, -d.z), new THREE.Vector3(d.x, 0.9, d.z), new THREE.Vector3(d.x * 0.2, 1.02, d.z * 0.2), new THREE.Vector3(-d.x * 0.2, 1.02, -d.z * 0.2)],
      [UP, UP, UP, UP],
      REGIONS.branch,
      [0.85, 0.85, 1, 1],
    );
  }
  return b.build();
}

// single needle tufts in the Mediterranean atlas BRANCH region (centre u,v), half size 0.05

/**
 * Aleppo pine (Pinus halepensis), height 1: a tall, often leaning or forked trunk that stays bare
 * for the lower ~60 %, then a few long ascending-then-spreading limbs that carry an irregular,
 * flat-topped umbrella of separate needle tufts (atlas BRANCH region = rosettes of needles)
 * with sky showing between the clumps.
 */
export function pineGeometry(seed = 3, crownBase = 0.45, width = 1): THREE.BufferGeometry {
  const b = new Builder();
  const r = rng(seed);
  // real Aleppo pines carry the canopy in the top third whatever the stand density
  const cb = Math.min(0.78, Math.max(0.6, crownBase));
  const lean = new THREE.Vector3(r() - 0.5, 0, r() - 0.5).multiplyScalar(0.2);
  const wob = r() * 6;
  const P = (t: number) =>
    new THREE.Vector3(lean.x * t * t + Math.sin(t * 6 + wob) * 0.012, t, lean.z * t * t + Math.cos(t * 5 + wob) * 0.012);
  const Y = new THREE.Vector3(0, 1, 0);

  // leaders: one, or a fork into two or three high up
  const forkT = cb - 0.05 - r() * 0.08;
  const nLead = r() < 0.4 ? 1 : r() < 0.7 ? 2 : 3;
  const a0 = r() * Math.PI * 2;
  const leaders: { off: THREE.Vector3; top: number }[] = [];
  for (let k = 0; k < nLead; k++) {
    const a = a0 + (k / nLead) * Math.PI * 2 + (r() - 0.5) * 0.6;
    const m = nLead === 1 ? 0.02 : 0.09 + r() * 0.08;
    leaders.push({ off: new THREE.Vector3(Math.cos(a) * m, 0, Math.sin(a) * m), top: 0.9 + r() * 0.1 - (k > 0 ? r() * 0.05 : 0) });
  }
  const Q = (k: number, t: number) => {
    const f = Math.max(0, (t - forkT) / (1 - forkT));
    return P(t).addScaledVector(leaders[k].off, f * (0.4 + 0.6 * f));
  };
  // bare trunk, in crooked segments
  const cuts = [0, forkT * 0.35, forkT * 0.7, forkT];
  for (let k = 0; k < 3; k++) {
    b.limb(P(cuts[k] - (k === 0 ? 0.05 : 0)), P(cuts[k + 1]), 0.017 - k * 0.0025, 0.0155 - k * 0.0025, 7, REGIONS.barkDark, 0.4 + k * 0.08, 0.45 + k * 0.08);
  }

  // needle tuft = a flat sprig seen from above/below plus two upright crossed ones
  const tuft = (c: THREE.Vector3, size: number, ao: number, upwards: number) => {
    // isolated round tufts baked into the Mediterranean atlas (FLOWERS region, 4×2 cells)
    const cell = Math.floor(r() * 8);
    const cu = 0.5 + (cell % 4) * 0.125, cv = cell < 4 ? 0.125 : 0;
    const reg: Region = { u0: cu, u1: cu + 0.125, v0: cv, v1: cv + 0.125 };
    size *= 1.45;
    const spin = r() * Math.PI * 2;
    const ex = new THREE.Vector3(Math.cos(spin), 0, Math.sin(spin));
    const ez = new THREE.Vector3(-Math.sin(spin), 0, Math.cos(spin));
    const s2 = size * 0.5;
    const flat = (cc: THREE.Vector3, sc: number, tilt: number, flip: boolean) => {
      const e1 = ex.clone().multiplyScalar(sc);
      const e2 = ez.clone().multiplyScalar(sc).addScaledVector(Y, tilt * sc);
      const n = Y.clone().addScaledVector(ex, 0.15).normalize();
      b.quad([cc.clone().sub(e1).sub(e2), cc.clone().add(e1).sub(e2), cc.clone().add(e1).add(e2), cc.clone().sub(e1).add(e2)], [n, n, n, n], reg, [ao * 0.85, ao * 0.85, ao, ao], flip);
    };
    // the main flat mat, slightly domed, and a smaller tilted one just under it
    flat(c, s2, upwards * 0.25, r() < 0.5);
    flat(c.clone().add(new THREE.Vector3(0, -size * 0.12, 0)), s2 * 0.8, -0.2 + upwards * 0.2, r() < 0.5);
    // upright crossed cards give volume from the side
    for (let k = 0; k < 2; k++) {
      const ang = spin + k * Math.PI * 0.5 + (r() - 0.5) * 0.5;
      const e1 = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang)).multiplyScalar(s2 * 0.95);
      const hgt = s2 * 0.7;
      const n = new THREE.Vector3(-Math.sin(ang), 0.3, Math.cos(ang)).normalize();
      const cc = c.clone().add(new THREE.Vector3(0, hgt * 0.1, 0));
      b.quad(
        [cc.clone().sub(e1).addScaledVector(Y, -hgt), cc.clone().add(e1).addScaledVector(Y, -hgt), cc.clone().add(e1).addScaledVector(Y, hgt), cc.clone().sub(e1).addScaledVector(Y, hgt)],
        [n, n, n, n], reg, [ao * 0.75, ao * 0.75, ao, ao], k === 1,
      );
    }
  };

  const crownH = 1 - cb;
  for (let k = 0; k < nLead; k++) {
    const top = leaders[k].top;
    // the leader itself
    const mids = [forkT, (forkT + top) / 2, top];
    for (let j = 0; j < 2; j++) b.limb(Q(k, mids[j]), Q(k, mids[j + 1]), 0.0105 - j * 0.0025, 0.008 - j * 0.0025, 5, REGIONS.barkDark, 0.5, 0.55);
    const lw = 1 / Math.sqrt(nLead);
    const branches = 3 + Math.floor(r() * 2);
    for (let j = 0; j < branches; j++) {
      const t = cb + 0.04 + (top - cb - 0.1) * (j / branches) + r() * 0.04;
      const from = Q(k, Math.min(t, top - 0.04));
      const a = a0 * 0.7 + k * 2.1 + (j / branches) * Math.PI * 2 + r() * 0.9;
      // spreading limbs, flatter higher up (umbrella)
      const rel = (t - cb) / crownH;
      const up = 0.22 + 0.5 * r() * (1 - rel * 0.5);
      const len = (0.1 + r() * 0.1) * width * lw * (1 - rel * 0.35) + 0.04;
      const dir = new THREE.Vector3(Math.cos(a), up, Math.sin(a)).normalize();
      const mid = from.clone().addScaledVector(dir, len * 0.55);
      const end = from.clone().addScaledVector(dir, len);
      b.limb(from, mid, 0.0065, 0.0045, 4, REGIONS.barkDark, 0.5, 0.58);
      b.limb(mid, end, 0.0045, 0.003, 4, REGIONS.barkDark, 0.55, 0.62);
      const hRel = Math.min(1, Math.max(0, (end.y - cb) / crownH));
      const ao = 0.55 + 0.45 * hRel;
      tuft(end.clone().add(new THREE.Vector3(0, 0.012, 0)), 0.11 + r() * 0.05, ao, 1);
      tuft(mid.clone().add(new THREE.Vector3((r() - 0.5) * 0.03, 0.01 + r() * 0.015, (r() - 0.5) * 0.03)), 0.085 + r() * 0.04, ao * 0.9, 0.5);
      // a cluster of clumps round the limb end, so crowns are full but lumpy, with sky between limbs
      const extra = 3 + Math.floor(r() * 3);
      for (let q = 0; q < extra; q++) {
        const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar((r() - 0.5) * 0.12);
        const along = (r() - 0.3) * 0.08;
        tuft(end.clone().addScaledVector(dir, along).add(side).add(new THREE.Vector3(0, (r() - 0.3) * 0.05, 0)), 0.07 + r() * 0.05, ao * (0.85 + r() * 0.15), r() < 0.5 ? 1 : 0.5);
      }
    }
    // crown top of this leader
    tuft(Q(k, top).add(new THREE.Vector3(0, 0.03, 0)), 0.12 + r() * 0.04, 1, 1);
  }
  return b.build();
}

/** European beech, height 1. width scales the crown (open-grown trees are wider). */
export function broadleafGeometry(seed = 2, crownBase = 0.4, width = 1): THREE.BufferGeometry {
  const b = new Builder();
  const r = rng(seed);
  const top = 0.98;
  const cy = crownBase + (top - crownBase) * 0.5;
  const ry = (top - crownBase) * 0.5;
  const rx = 0.3 * width;
  b.limb(new THREE.Vector3(0, -0.05, 0), new THREE.Vector3(0, crownBase + ry * 0.6, 0), 0.022, 0.012, 7, REGIONS.barkLight, 0.45, 0.6);
  // main limbs fork up and out, visible through gaps in the crown; each ends in a leaf clump
  const clumps: { c: THREE.Vector3; r: number }[] = [];
  const limbs = 7;
  for (let k = 0; k < limbs; k++) {
    const a = (k / limbs) * Math.PI * 2 + r() * 0.7;
    const reach = 0.4 + r() * 0.5;
    const from = new THREE.Vector3(0, crownBase + ry * (0.15 + r() * 0.45), 0);
    const to = new THREE.Vector3(Math.cos(a) * rx * reach, cy + ry * (-0.1 + r() * 0.75), Math.sin(a) * rx * reach);
    b.limb(from, to, 0.009, 0.004, 5, REGIONS.barkLight, 0.4, 0.55);
    clumps.push({ c: to, r: rx * (0.32 + r() * 0.22) });
  }
  clumps.push({ c: new THREE.Vector3((r() - 0.5) * rx * 0.3, top - ry * 0.3, (r() - 0.5) * rx * 0.3), r: rx * 0.4 });
  // leaf clusters: cloud-like clumps (irregular silhouette) plus a thin inner fill
  const cards = 120;
  for (let k = 0; k < cards; k++) {
    let c: THREE.Vector3;
    let outward: THREE.Vector3;
    if (k % 6 === 0) {
      const u = r() * 2 - 1;
      const a = r() * Math.PI * 2;
      const sq = Math.sqrt(1 - u * u);
      outward = new THREE.Vector3(Math.cos(a) * sq, u * 0.9 + 0.12, Math.sin(a) * sq).normalize();
      const depth = 0.35 + r() * 0.4;
      c = new THREE.Vector3(outward.x * rx * depth, cy + outward.y * ry * depth, outward.z * rx * depth);
    } else {
      const cl = clumps[Math.floor(r() * clumps.length)];
      const u = r() * 2 - 1;
      const a = r() * Math.PI * 2;
      const sq = Math.sqrt(1 - u * u);
      const dir = new THREE.Vector3(Math.cos(a) * sq, u * 0.8 + 0.15, Math.sin(a) * sq).normalize();
      c = cl.c.clone().addScaledVector(dir, cl.r * (0.45 + r() * 0.55));
      // face away from the clump centre and the crown centre
      outward = dir.add(new THREE.Vector3(c.x, (c.y - cy) * 0.5, c.z).normalize().multiplyScalar(0.6)).normalize();
    }
    const ex = c.x / (rx * 1.25), ey = (c.y - cy) / (ry * 1.2), ez = c.z / (rx * 1.25);
    const e = Math.hypot(ex, ey, ez);
    const size = (0.075 + r() * 0.055) * Math.max(0.8, width * 0.9);
    const t1 = new THREE.Vector3().crossVectors(outward, Math.abs(outward.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : UP).normalize();
    const t2 = new THREE.Vector3().crossVectors(outward, t1).normalize();
    const spin = r() * Math.PI * 2;
    const e1 = t1.clone().multiplyScalar(Math.cos(spin)).add(t2.clone().multiplyScalar(Math.sin(spin))).multiplyScalar(size);
    const e2 = t1.clone().multiplyScalar(-Math.sin(spin)).add(t2.clone().multiplyScalar(Math.cos(spin))).multiplyScalar(size);
    const p = [c.clone().sub(e1).sub(e2), c.clone().add(e1).sub(e2), c.clone().add(e1).add(e2), c.clone().sub(e1).add(e2)];
    const n = outward.clone().add(new THREE.Vector3(0, 0.4, 0)).normalize();
    const rel = Math.min(1, e);
    const ao = (0.42 + 0.58 * rel) * (0.75 + 0.25 * Math.max(0, outward.y));
    b.quad(p, [n, n, n, n], REGIONS.leaves, [ao, ao, ao, ao], k % 2 === 0);
  }
  return b.build();
}
