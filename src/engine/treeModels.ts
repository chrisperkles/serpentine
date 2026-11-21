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
type RGB = [number, number, number];

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
    this.quadC(p, n, reg, ao.map((a) => [a, a, a] as RGB), flipU, vRange);
  }

  /** Quad with a per-vertex colour (bark tints, shaded foliage). */
  quadC(p: THREE.Vector3[], n: THREE.Vector3[], reg: Region, col: RGB[], flipU = false, vRange: [number, number] = [0, 1]) {
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
      this.col.push(col[i][0], col[i][1], col[i][2]);
    }
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }

  /**
   * Bent tube along a polyline with a radius and a colour per ring. Frames are carried along the
   * path, so thick curved limbs do not twist; the bark texture wraps once round each ring.
   */
  tube(pts: THREE.Vector3[], radii: number[], seg: number, reg: Region, tint: (ring: number, k: number) => RGB) {
    const fr: [THREE.Vector3, THREE.Vector3][] = [];
    let x: THREE.Vector3 | undefined;
    for (let i = 0; i < pts.length; i++) {
      const t = pts[Math.min(i + 1, pts.length - 1)].clone().sub(pts[Math.max(i - 1, 0)]).normalize();
      if (!x) x = new THREE.Vector3().crossVectors(Math.abs(t.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : UP, t).normalize();
      else x = x.clone().addScaledVector(t, -x.dot(t)).normalize();
      fr.push([x.clone(), new THREE.Vector3().crossVectors(t, x)]);
    }
    const ring = (i: number, a: number) => fr[i][0].clone().multiplyScalar(Math.cos(a)).addScaledVector(fr[i][1], Math.sin(a));
    const n = pts.length - 1;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < seg; k++) {
        const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
        const o = [ring(i, a0), ring(i, a1), ring(i + 1, a1), ring(i + 1, a0)];
        const p = [
          pts[i].clone().addScaledVector(o[0], radii[i]),
          pts[i].clone().addScaledVector(o[1], radii[i]),
          pts[i + 1].clone().addScaledVector(o[2], radii[i + 1]),
          pts[i + 1].clone().addScaledVector(o[3], radii[i + 1]),
        ];
        const sub: Region = {
          u0: reg.u0 + ((reg.u1 - reg.u0) * k) / seg,
          u1: reg.u0 + ((reg.u1 - reg.u0) * (k + 1)) / seg,
          v0: reg.v0,
          v1: reg.v1,
        };
        const c0 = tint(i, k), c1 = tint(i + 1, k);
        this.quadC(p, o, sub, [c0, c0, c1, c1], false, [i / n, (i + 1) / n]);
      }
    }
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


export type ParkSpecies = 'elm' | 'plane' | 'oak';

interface ParkShape {
  fork: number; // height where the trunk splits
  trunkR: number; // radius at breast height (model units: the instance scale is the crown width)
  limbs: number;
  reach: number; // horizontal reach of the crown centres
  path: [number, number][]; // limb as [outward fraction, rise above the fork]
  limbR: number;
  clusterR: number;
  cards: number; // cards per leaf cluster
  leaderTop: number; // top of the central leader (0 = none)
  crownY: number; // crown centre, for the shading normals
  crownRy: number;
}

// Elm: clear trunk, 4-5 steep limbs that arch out into a vase, widest near the top.
// Plane: shorter, sturdier trunk, heavy near-horizontal limbs, open round crown.
// Oak: short trunk, broad dense dome.
const PARK: Record<ParkSpecies, ParkShape> = {
  elm: { fork: 0.36, trunkR: 0.0185, limbs: 5, reach: 0.27, path: [[0, 0], [0.2, 0.13], [0.55, 0.26], [0.98, 0.34]], limbR: 0.012, clusterR: 0.15, cards: 7, leaderTop: 0.78, crownY: 0.7, crownRy: 0.3 },
  plane: { fork: 0.28, trunkR: 0.022, limbs: 5, reach: 0.28, path: [[0, 0], [0.16, 0.07], [0.55, 0.17], [0.98, 0.27]], limbR: 0.015, clusterR: 0.155, cards: 6, leaderTop: 0.7, crownY: 0.64, crownRy: 0.32 },
  oak: { fork: 0.22, trunkR: 0.022, limbs: 6, reach: 0.28, path: [[0, 0], [0.18, 0.1], [0.55, 0.24], [0.98, 0.36]], limbR: 0.0135, clusterR: 0.16, cards: 7, leaderTop: 0.72, crownY: 0.6, crownRy: 0.34 },
};

/**
 * New York park tree, height 1. Leaves sit in round clusters of crossed cards (not single cards
 * pointing out of the crown), shaded with smooth crown-wide normals; trunks flare at the base.
 * Plane bark is mottled cream and olive, elm and oak bark dark grey-brown.
 */
export function parkTreeGeometry(species: ParkSpecies, seed = 1, width = 1): THREE.BufferGeometry {
  const P = PARK[species];
  const b = new Builder();
  const r = rng(seed);
  const reg = species === 'plane' ? REGIONS.barkLight : REGIONS.barkDark;
  // bark colour per ring and segment; the texture alone is too saturated (dark) or too plain
  const patch = (i: number, k: number) => {
    const h = Math.sin(i * 12.9898 + k * 78.233 + seed * 3.1) * 43758.5453;
    return h - Math.floor(h);
  };
  const barkTint = (shade: number) => (i: number, k: number): RGB => {
    const n = patch(i, k);
    if (species === 'plane') {
      // flaking patches: cream where the outer bark has peeled, olive-grey and dark between
      const c: RGB = n > 0.55 ? [4.0, 3.5, 2.6] : n > 0.25 ? [2.3, 2.15, 1.5] : [1.3, 1.25, 0.95];
      return [c[0] * shade, c[1] * shade, c[2] * shade];
    }
    const v = (0.85 + n * 0.3) * shade;
    return species === 'elm' ? [0.62 * v, 0.55 * v, 0.5 * v] : [0.55 * v, 0.5 * v, 0.46 * v];
  };
  const seg = 8;
  const flare = [2.0, 1.45, 1.15, 1.0, 0.97, 0.95, 0.93, 0.92];
  const nT = flare.length;
  const trunkPts: THREE.Vector3[] = [];
  const lean = new THREE.Vector3((r() - 0.5) * 0.03, 0, (r() - 0.5) * 0.03);
  const trunkRad: number[] = [];
  for (let i = 0; i < nT; i++) {
    const t = i / (nT - 1);
    const y = -0.05 + (P.fork + 0.05) * (i === 0 ? 0 : Math.pow(t, 1.25));
    trunkPts.push(new THREE.Vector3(lean.x * t * t, y, lean.z * t * t));
    trunkRad.push(P.trunkR * flare[i] * (1 - 0.25 * t));
  }
  b.tube(trunkPts, trunkRad, seg, reg, barkTint(species === 'plane' ? 0.9 : 0.8));
  const top0 = trunkPts[nT - 1].clone();

  // shading: ellipsoid normals round the whole crown, lit alike from either face of a card
  const rxc = P.reach + P.clusterR;
  const shadeAt = (p: THREE.Vector3) => {
    const e = new THREE.Vector3(p.x / rxc, (p.y - P.crownY) / P.crownRy, p.z / rxc);
    const len = e.length();
    const n = e.clone().normalize();
    n.y += 0.35;
    n.normalize();
    // inner leaves and the underside of the crown stay darker
    const ao = (0.45 + 0.55 * Math.min(1, len)) * (0.72 + 0.28 * Math.min(1, Math.max(0, 0.5 + 0.5 * e.y)));
    return { n, ao };
  };
  const cluster = (c: THREE.Vector3, R: number) => {
    for (let q = 0; q < P.cards; q++) {
      const u = r() * 2 - 1;
      const a = r() * Math.PI * 2;
      const sq = Math.sqrt(1 - u * u);
      const dir = new THREE.Vector3(Math.cos(a) * sq, u, Math.sin(a) * sq);
      const ctr = c.clone().addScaledVector(dir, R * (0.1 + 0.45 * r()));
      // a third of the cards lie flat so crowns read as leafy from above; the rest cross at random
      const nrm = q % 3 === 0 ? new THREE.Vector3((r() - 0.5) * 0.5, 1, (r() - 0.5) * 0.5).normalize() : dir.clone().add(new THREE.Vector3(0, 0.3, 0)).normalize();
      const t1 = new THREE.Vector3().crossVectors(nrm, Math.abs(nrm.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : UP).normalize();
      const t2 = new THREE.Vector3().crossVectors(nrm, t1).normalize();
      const spin = r() * Math.PI * 2;
      const s = R * (0.66 + r() * 0.2) * Math.max(0.85, width * 0.9);
      const e1 = t1.clone().multiplyScalar(Math.cos(spin)).addScaledVector(t2, Math.sin(spin)).multiplyScalar(s);
      const e2 = t1.clone().multiplyScalar(-Math.sin(spin)).addScaledVector(t2, Math.cos(spin)).multiplyScalar(s);
      const p = [ctr.clone().sub(e1).sub(e2), ctr.clone().add(e1).sub(e2), ctr.clone().add(e1).add(e2), ctr.clone().sub(e1).add(e2)];
      const sh = p.map(shadeAt);
      b.quadC(p, sh.map((x) => x.n), REGIONS.leaves, sh.map((x) => [x.ao, x.ao, x.ao] as RGB), q % 2 === 0);
    }
  };

  const limbTint = barkTint(species === 'plane' ? 1 : 0.7);
  const a0 = r() * Math.PI * 2;
  for (let k = 0; k < P.limbs; k++) {
    const a = a0 + (k / P.limbs) * Math.PI * 2 + (r() - 0.5) * 0.7;
    const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const side = new THREE.Vector3(-out.z, 0, out.x);
    const reach = P.reach * (0.8 + r() * 0.3);
    const rise = 0.9 + r() * 0.2;
    const pts = P.path.map(([f, dy]) => top0.clone().addScaledVector(out, f * reach).add(new THREE.Vector3(0, dy * rise, 0)));
    // slight sideways meander so limbs are not planar arcs
    pts[2].addScaledVector(side, (r() - 0.5) * 0.06);
    const lr = P.limbR * (0.85 + r() * 0.3);
    b.tube(pts, [lr * 1.25, lr, lr * 0.62, lr * 0.3], 5, reg, limbTint);
    const end = pts[3];
    cluster(end.clone().add(new THREE.Vector3(0, 0.02, 0)), P.clusterR * (0.95 + r() * 0.2));
    cluster(pts[2].clone().add(new THREE.Vector3(side.x * 0.03, 0.05, side.z * 0.03)), P.clusterR * 0.9);
    // two side branches off the outer limb, each ending in a smaller clump
    for (let j = 0; j < 2; j++) {
      const from = pts[2].clone().lerp(pts[3], 0.3 + 0.4 * j);
      const dir = out.clone().multiplyScalar(0.7).addScaledVector(side, (j === 0 ? -1 : 1) * 0.7).add(new THREE.Vector3(0, 0.35, 0)).normalize();
      const to = from.clone().addScaledVector(dir, 0.11 + r() * 0.05);
      b.tube([from, to], [lr * 0.4, lr * 0.2], 4, reg, limbTint);
      cluster(to.add(new THREE.Vector3(0, 0.02, 0)), P.clusterR * 0.82);
    }
  }
  if (P.leaderTop > 0) {
    // central leader: the crown is full on top, and the limbs do not all start at one point
    const mid = top0.clone().add(new THREE.Vector3(0, (P.leaderTop - 0.05 - P.fork) * 0.5, 0));
    const tp = top0.clone().add(new THREE.Vector3((r() - 0.5) * 0.04, P.leaderTop - 0.05 - P.fork, (r() - 0.5) * 0.04));
    b.tube([top0, mid, tp], [P.limbR * 1.1, P.limbR * 0.8, P.limbR * 0.45], 5, reg, limbTint);
    cluster(tp.clone().add(new THREE.Vector3(0, 0.07, 0)), P.clusterR * 1.05);
    cluster(mid.clone().add(new THREE.Vector3(0.04, 0.1, -0.03)), P.clusterR * 0.9);
  }
  return b.build();
}

// ---- Sydney's east coast (biome.sydneyTrees): eucalypt, Moreton Bay fig, Norfolk Island pine, street tree ----

/**
 * Sydney eucalypt (blue gum / spotted gum), height 1: a tall, pale, smooth trunk, a few steep forking limbs and
 * an open, uneven crown of drooping leaf clumps with sky between them. `lush` adds clumps (garden and street trees).
 */
export function eucalyptGeometry(seed = 1, lush = 0.5): THREE.BufferGeometry {
  const b = new Builder();
  const r = rng(seed);
  const reg = REGIONS.barkLight;
  // smooth bark: cream to grey, with a darker rough stocking on the lowest metre (the texture alone is too brown)
  const bark = (i: number, k: number): RGB => {
    const n = Math.sin(i * 7.7 + k * 31.1 + seed) * 0.5 + 0.5;
    const stocking = i < 2 ? 0.55 : 1;
    const v = (1.45 + n * 0.45) * stocking;
    return [v * 1.0, v * 0.95, v * 0.86];
  };
  const fork = 0.34 + r() * 0.1;
  const lean = new THREE.Vector3((r() - 0.5) * 0.06, 0, (r() - 0.5) * 0.06);
  const trunk: THREE.Vector3[] = [];
  const rad: number[] = [];
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    trunk.push(new THREE.Vector3(lean.x * t * t, -0.05 + (fork + 0.05) * t, lean.z * t * t));
    rad.push(0.017 * (i === 0 ? 1.5 : 1.0 - 0.3 * t));
  }
  b.tube(trunk, rad, 7, reg, bark);
  const top = trunk[5].clone();
  const clumps: THREE.Vector3[] = [];
  const nl = 4 + Math.floor(r() * 2);
  const a0 = r() * Math.PI * 2;
  for (let k = 0; k < nl; k++) {
    const a = a0 + (k / nl) * Math.PI * 2 + (r() - 0.5) * 0.9;
    const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const reach = 0.12 + r() * 0.2;
    const rise = 0.28 + r() * 0.3;
    const mid = top.clone().addScaledVector(out, reach * 0.4).add(new THREE.Vector3((r() - 0.5) * 0.04, rise * 0.5, 0));
    const end = top.clone().addScaledVector(out, reach).add(new THREE.Vector3(0, rise, 0));
    b.tube([top, mid, end], [0.011, 0.0075, 0.0035], 5, reg, bark);
    clumps.push(end);
    // a side branch with its own clump
    const sb = mid.clone().addScaledVector(new THREE.Vector3(-out.z, 0.3, out.x), (r() < 0.5 ? 1 : -1) * (0.09 + r() * 0.08)).addScaledVector(out, 0.05);
    b.tube([mid, sb], [0.006, 0.003], 4, reg, bark);
    clumps.push(sb);
  }
  clumps.push(top.clone().add(new THREE.Vector3((r() - 0.5) * 0.06, 0.5 + r() * 0.1, (r() - 0.5) * 0.06)));
  const cards = Math.round(20 + lush * 10);
  for (const c of clumps) {
    for (let q = 0; q < cards / 2; q++) {
      const a = r() * Math.PI * 2;
      const d = r() * 0.11;
      // leaves hang: cards taller than wide, lower edge darker, with a lean outward
      const ctr = c.clone().add(new THREE.Vector3(Math.cos(a) * d, (r() - 0.55) * 0.07, Math.sin(a) * d));
      const sa = r() * Math.PI;
      const sw = 0.06 + r() * 0.035, sh = sw * (1.25 + r() * 0.5);
      const e1 = new THREE.Vector3(Math.cos(sa), 0, Math.sin(sa)).multiplyScalar(sw);
      const e2 = new THREE.Vector3(0, sh, 0);
      const n = new THREE.Vector3(-Math.sin(sa), 0.55, Math.cos(sa)).normalize();
      const rel = Math.min(1, Math.max(0.35, (ctr.y - 0.3) / 0.7));
      const aoT = 0.62 + 0.38 * rel, aoB = aoT * 0.62;
      b.quadC(
        [ctr.clone().sub(e1).sub(e2), ctr.clone().add(e1).sub(e2), ctr.clone().add(e1).add(e2), ctr.clone().sub(e1).add(e2)],
        [n, n, n, n], REGIONS.leaves, [[aoB, aoB, aoB], [aoB, aoB, aoB], [aoT, aoT, aoT], [aoT, aoT, aoT]], q % 2 === 0,
      );
    }
  }
  return b.build();
}

/**
 * Moreton Bay fig, height 1: a short, massive, buttressed trunk, a few limbs spreading wide and low and a very
 * dense, dark, flat-topped dome that reaches well past the trunk (crown radius ~0.46).
 */
export function figGeometry(seed = 1): THREE.BufferGeometry {
  const b = new Builder();
  const r = rng(seed);
  const reg = REGIONS.barkDark;
  const bark = (i: number, k: number): RGB => {
    const n = Math.sin(i * 5.3 + k * 17.7 + seed) * 0.5 + 0.5;
    const v = 0.7 + n * 0.3;
    return [v * 0.95, v * 0.88, v * 0.8];
  };
  const flare = [2.4, 1.6, 1.15, 1.0, 0.95];
  const trunk: THREE.Vector3[] = flare.map((_, i) => new THREE.Vector3(0, -0.05 + 0.3 * (i / 4) ** 1.2, 0));
  b.tube(trunk, flare.map((f, i) => 0.03 * f * (1 - 0.1 * i / 4)), 9, reg, bark);
  const top = trunk[4].clone();
  const clumps: { c: THREE.Vector3; R: number }[] = [];
  const nl = 6;
  const a0 = r() * Math.PI * 2;
  for (let k = 0; k < nl; k++) {
    const a = a0 + (k / nl) * Math.PI * 2 + (r() - 0.5) * 0.6;
    const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const reach = 0.3 + r() * 0.12;
    const pts = [[0, 0], [0.3, 0.07], [0.65, 0.14], [1, 0.2]].map(([f, dy]) => top.clone().addScaledVector(out, f * reach).add(new THREE.Vector3(0, dy + r() * 0.02, 0)));
    b.tube(pts, [0.024, 0.016, 0.009, 0.005], 6, reg, bark);
    clumps.push({ c: pts[3].clone().add(new THREE.Vector3(0, 0.12, 0)), R: 0.2 });
    clumps.push({ c: pts[2].clone().add(new THREE.Vector3(0, 0.2, 0)), R: 0.22 });
  }
  clumps.push({ c: top.clone().add(new THREE.Vector3(0, 0.45, 0)), R: 0.26 });
  // the dome: flat-topped, so the clumps follow a shallow ellipsoid; cards face outward and lie flat on top
  const cy = 0.62, ry = 0.36, rx = 0.47;
  for (const { c, R } of clumps) {
    for (let q = 0; q < 24; q++) {
      const u = r() * 2 - 1, a = r() * Math.PI * 2, sq = Math.sqrt(1 - u * u);
      const dir = new THREE.Vector3(Math.cos(a) * sq, u, Math.sin(a) * sq);
      const ctr = c.clone().addScaledVector(dir, R * (0.2 + 0.7 * r()));
      ctr.y = Math.min(ctr.y, 0.97);
      const e = new THREE.Vector3((ctr.x) / rx, (ctr.y - cy) / ry, ctr.z / rx);
      const len = e.length();
      const nrm = e.clone().normalize();
      nrm.y += 0.4;
      nrm.normalize();
      const flat = q % 3 === 0;
      const nn = flat ? new THREE.Vector3((r() - 0.5) * 0.4, 1, (r() - 0.5) * 0.4).normalize() : dir.clone().add(new THREE.Vector3(0, 0.3, 0)).normalize();
      const t1 = new THREE.Vector3().crossVectors(nn, Math.abs(nn.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : UP).normalize();
      const t2 = new THREE.Vector3().crossVectors(nn, t1).normalize();
      const sp = r() * Math.PI * 2;
      const s = R * (0.62 + r() * 0.25);
      const e1 = t1.clone().multiplyScalar(Math.cos(sp)).addScaledVector(t2, Math.sin(sp)).multiplyScalar(s);
      const e2 = t1.clone().multiplyScalar(-Math.sin(sp)).addScaledVector(t2, Math.cos(sp)).multiplyScalar(s);
      const p = [ctr.clone().sub(e1).sub(e2), ctr.clone().add(e1).sub(e2), ctr.clone().add(e1).add(e2), ctr.clone().sub(e1).add(e2)];
      const ao = (0.5 + 0.5 * Math.min(1, len)) * (0.7 + 0.3 * Math.min(1, Math.max(0, 0.5 + 0.5 * e.y)));
      b.quadC(p, [nrm, nrm, nrm, nrm], REGIONS.leaves, p.map(() => [ao, ao, ao] as RGB), q % 2 === 0);
    }
  }
  return b.build();
}

/**
 * Norfolk Island pine (Araucaria heterophylla), height 1: a dead-straight trunk and whorls of five horizontal
 * branches every few percent of the height, shortening to a spire, each branch a flat spray of needles with
 * upturned tips. Perfectly symmetric, crown radius ~0.16 at the base of the foliage.
 */
export function norfolkPineGeometry(seed = 1): THREE.BufferGeometry {
  const b = new Builder();
  const r = rng(seed);
  b.limb(new THREE.Vector3(0, -0.05, 0), new THREE.Vector3(0, 0.98, 0), 0.0125, 0.003, 7, REGIONS.barkDark, 0.55, 0.7);
  const whorls = 17;
  const y0 = 0.22;
  for (let k = 0; k < whorls; k++) {
    const rel = k / (whorls - 1);
    const y = y0 + rel * (0.94 - y0);
    const len = 0.04 + 0.13 * Math.pow(1 - rel, 0.85);
    const twist = r() * 1.2 + k * 0.63;
    const ao = 0.5 + 0.5 * rel;
    for (let j = 0; j < 5; j++) {
      const a = twist + (j / 5) * Math.PI * 2;
      const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const side = new THREE.Vector3(-dir.z, 0, dir.x);
      const w = len * 0.55;
      // the branch dips a little, then the tip curves up
      const p0 = dir.clone().multiplyScalar(0.005).setY(y);
      const p1 = dir.clone().multiplyScalar(len).setY(y + len * 0.12);
      const nO = new THREE.Vector3(0, 1, 0).addScaledVector(dir, 0.2).normalize();
      b.quad(
        [p0.clone().addScaledVector(side, -w * 0.3), p1.clone().addScaledVector(side, -w), p1.clone().addScaledVector(side, w), p0.clone().addScaledVector(side, w * 0.3)],
        [nO, nO, nO, nO], REGIONS.branch, [ao * 0.7, ao, ao, ao * 0.7], j % 2 === 0,
      );
      // a hanging curtain under the spray gives the tier its thickness from the side
      const dn = new THREE.Vector3(0, -len * 0.3, 0);
      b.quad(
        [p0.clone().add(dn).addScaledVector(side, -w * 0.15), p1.clone().add(dn).addScaledVector(side, -w * 0.4), p1.clone().addScaledVector(side, w * 0.4).setY(y + len * 0.2), p0.clone().addScaledVector(side, w * 0.15).setY(y + 0.01)],
        [nO, nO, nO, nO], REGIONS.branch, [ao * 0.55, ao * 0.7, ao, ao * 0.8], j % 2 === 1, [0.1, 0.9],
      );
    }
  }
  // leader
  for (let j = 0; j < 2; j++) {
    const a = (j / 2) * Math.PI;
    const d = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(0.03);
    b.quad([new THREE.Vector3(-d.x, 0.86, -d.z), new THREE.Vector3(d.x, 0.86, d.z), new THREE.Vector3(d.x * 0.1, 1.03, d.z * 0.1), new THREE.Vector3(-d.x * 0.1, 1.03, -d.z * 0.1)], [UP, UP, UP, UP], REGIONS.branch, [0.9, 0.9, 1, 1]);
  }
  return b.build();
}
