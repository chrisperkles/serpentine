// Close-range 3D ground cover along the road: grass tufts, alpine flowers and boulders,
// generated in route chunks around the rider and recycled as they ride on.

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Line } from '../geo/osm.ts';
import type { Route, RouteIndex } from '../geo/route.ts';
import { patchMaterial } from './atmosphere.ts';
import { broadleafGeometry, preserveCoverage, REGIONS, treeAtlas } from './treeModels.ts';
import { loadModel } from './Landmarks.ts';
import { ALPINE, type Biome } from './biome.ts';
import { STREET_LEDGE } from './Road.ts';
import { PAVING_GLSL } from './groundTextures.ts';

const CHUNK = 40; // metres of route per chunk
const AHEAD = 280;
const BEHIND = 70;
const REACH = 24; // metres beside the road edge

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

/** Mapped footways that become a visible surface in the city biomes (parks, sidewalks), with their width (m). */
const PATH_WIDTH: Record<string, number> = { footway: 2.0, path: 2.0, pedestrian: 4.0, cycleway: 2.6, bridleway: 2.4 };

/**
 * Footpaths as thin ribbons draped over the terrain: crisp edges at any width, which the 3 m land-cover mask cannot give.
 * Central Park's are pale asphalt, Vienna's paved sidewalks or (inside parks) fine gravel, Sydney's concrete with joints.
 */
function pathMaterial(biome: Biome) {
  const mat = new THREE.MeshLambertMaterial({ transparent: true, depthWrite: false });
  const kind = biome.suburb ? 2 : biome.streets ? 1 : 0;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uPathKind = { value: kind };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 pathUv;\nvarying vec3 vPath;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPath = pathUv;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uPathKind;
varying vec3 vPath;
${PAVING_GLSL}
float pn(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1, 0)), f.x), mix(gHash(i + vec2(0, 1)), gHash(i + vec2(1, 1)), f.x), f.y);
}`,
      )
      .replace(
        '#include <map_fragment>',
        `{
  // vPath: metres across (signed), metres along, half width; z < 0 marks a gravel path inside a Vienna park
  float hw = abs(vPath.z);
  float across = vPath.x;
  vec2 pp = vec2(across, vPath.y);
  float pix = gPix(pp);
  float inner = hw - abs(across);
  float edge = clamp(inner / max(pix, 1e-3) + 0.5, 0.0, 1.0);
  vec3 col;
  float n = 0.9 + 0.2 * pn(pp * vec2(1.7, 0.9)) + 0.08 * (pn(pp * 23.0) - 0.5);
  if (uPathKind < 0.5) {
    // Central Park: pale grey asphalt, a darker worn middle, a hairline of grit at the edge
    col = vec3(0.27, 0.265, 0.255) * n;
    col *= 1.0 - 0.1 * (1.0 - smoothstep(0.0, 0.5, abs(across)));
  } else if (uPathKind < 1.5) {
    if (vPath.z < 0.0) {
      // fine park gravel: warm sand with pale pebbles
      col = vec3(0.46, 0.39, 0.29) * n * (0.86 + 0.28 * pn(pp * 38.0));
    } else {
      vec2 sid = vec2(0.0);
      float js = gJoint(pp, vec2(0.6, 0.9), 0.014, pix, sid);
      float tone = mix(1.0, 0.9 + 0.2 * gHash(sid), 1.0 - smoothstep(0.1, 0.45, pix / 0.6));
      col = vec3(0.3, 0.285, 0.26) * n * tone * (1.0 - 0.55 * js);
    }
  } else {
    // Sydney: concrete, a saw-cut joint every 1.5 m
    float dj = abs(fract(vPath.y / 1.5) - 0.5) * 1.5;
    float jt = clamp((0.008 - dj) / max(pix, 1e-4) + 0.5, 0.0, 1.0) * (1.0 - smoothstep(0.012, 0.06, pix));
    col = vec3(0.36, 0.35, 0.33) * n * (1.0 - 0.35 * jt);
  }
  // a few cm of shade where the surface meets the verge
  col *= 1.0 - 0.3 * (1.0 - smoothstep(0.0, 0.07, inner));
  diffuseColor.rgb = col;
  diffuseColor.a = edge;
}`,
      );
  };
  return patchMaterial(mat, { key: `paths${kind}`, depthBias: 0.006 });
}

function tuftGeometry(reg: { u0: number; v0: number; u1: number; v1: number }): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  // the atlas tuft is 2:1, so the card is twice as wide as tall
  const w = 0.42;
  const h = 0.44;
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI;
    const cx = Math.cos(a) * w;
    const cz = Math.sin(a) * w;
    const base = pos.length / 3;
    pos.push(-cx, -0.04, -cz, cx, -0.04, cz, cx, h, cz, -cx, h, -cz);
    uv.push(reg.u0, reg.v0, reg.u1, reg.v0, reg.u1, reg.v1, reg.u0, reg.v1);
    for (let i = 0; i < 4; i++) nor.push(0, 1, 0);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

/** Low rounded shrub (rosemary, mastic): crossed half-dome cards plus a tilted ring. */
function cushionGeometry(): THREE.BufferGeometry {
  const reg = REGIONS.flowers;
  const pos: number[] = [];
  const uv: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  const card = (a: number, tilt: number, r: number, h: number, y0: number) => {
    const dx = Math.cos(a) * r, dz = Math.sin(a) * r;
    const tx = -Math.sin(a) * Math.sin(tilt) * h, tz = Math.cos(a) * Math.sin(tilt) * h;
    const b = pos.length / 3;
    pos.push(-dx, y0, -dz, dx, y0, dz, dx + tx, y0 + h * Math.cos(tilt), dz + tz, -dx + tx, y0 + h * Math.cos(tilt), -dz + tz);
    uv.push(reg.u0, reg.v0, reg.u1, reg.v0, reg.u1, reg.v1, reg.u0, reg.v1);
    for (let i = 0; i < 4; i++) nor.push(0, 1, 0);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  for (let k = 0; k < 4; k++) card((k / 4) * Math.PI, 0, 0.5, 0.5, -0.04);
  for (let k = 0; k < 5; k++) card((k / 5) * Math.PI * 2, 1.0, 0.32, 0.42, 0.12);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

function rockGeometry(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(0.5, 1);
  const p = g.getAttribute('position');
  const r = rng(5);
  for (let i = 0; i < p.count; i++) {
    const s = 0.75 + r() * 0.5;
    p.setXYZ(i, p.getX(i) * s, p.getY(i) * s * 0.65, p.getZ(i) * s);
  }
  g.computeVertexNormals();
  return g.translate(0, 0.12, 0);
}

/**
 * A weathered, rounded field stone (flysch, marl, glacial erratic): smooth lumps, no facets. Half a metre across,
 * flatter than tall, so a quarter buried in a bank reads as a stone that has been there for years.
 */
function stoneGeometry(): THREE.BufferGeometry {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(0.5, 3);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-4);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 1 + 0.14 * Math.sin(x * 6 + 1.3) * Math.cos(z * 5 + 0.4) + 0.1 * Math.sin(y * 8 + x * 4 + 2);
    p.setXYZ(i, x * n * 1.12, y * n * 0.62, z * n);
  }
  g.computeVertexNormals();
  return g;
}

interface Chunk {
  index: number;
  meshes: THREE.InstancedMesh[];
  /** Footpath ribbons of the chunk (city biomes). */
  paths?: THREE.Mesh;
}

export interface GroundCoverOptions {
  route: Route;
  index: RouteIndex;
  halfWidth: number;
  groundHeight: (x: number, z: number) => number;
  roads?: Line[];
  isWater?: (x: number, z: number) => boolean;
  density?: number;
  /** Land cover at a point: 0 none, 1 meadow, 2 built-up, 3 water. */
  coverAt?: (x: number, z: number) => number;
  /** Tree canopy 0..1 at a point (forest floor gets ferns instead of meadow grass). */
  canopyAt?: (x: number, z: number) => number;
  /** OSM scree / bare rock 0..1 at a point: no grass there, only the odd boulder. */
  screeAt?: (x: number, z: number) => number;
  biome?: Biome;
}

export class GroundCover extends THREE.Group {
  private o: GroundCoverOptions;
  private chunks = new Map<number, Chunk>();
  private grassMat: THREE.MeshLambertMaterial;
  private flowerMat: THREE.MeshLambertMaterial;
  private rockMat: THREE.Material;
  private sharedRockMat = false;
  private disposed = false;
  private tuft = tuftGeometry(REGIONS.grass);
  private flowerTuft = tuftGeometry(REGIONS.flowers);
  private cushion = cushionGeometry();
  private shrub: THREE.BufferGeometry | null = null;
  private shrubMat: THREE.Material | null = null;
  private rock = rockGeometry();
  private stone = stoneGeometry();
  private stoneMat: THREE.Material;
  /** Vegetated Alpine cut banks (biome.banks): saplings, ferns, hanging grass and field stones on steep ground. */
  private bankLife: boolean;
  private fern: THREE.BufferGeometry | null = null;
  private fernMat: THREE.Material | null = null;
  private palm: THREE.BufferGeometry | null = null;
  private palmMats: THREE.Material | THREE.Material[] | null = null;
  private biome: Biome;
  private roadGrid = new Map<number, number[]>();
  private roadSegs: number[] = [];
  private pathMat: THREE.Material | null = null;
  private pathLines: { pts: Float32Array; half: number }[] = [];
  private pathGrid = new Map<number, number[]>();

  constructor(o: GroundCoverOptions) {
    super();
    this.o = { density: 1, ...o };
    this.biome = o.biome ?? ALPINE;
    const B0 = this.biome;
    this.bankLife = !!B0.banks && !B0.lawn && !B0.streets && !B0.suburb && !B0.karst;
    // weathered grey-brown field stones for the banks (the scanned boulders are faceted and pale)
    this.stoneMat = patchMaterial(new THREE.MeshStandardMaterial({ color: new THREE.Color(0.3, 0.29, 0.255), roughness: 1 }), { key: 'bankstone' });
    // photographic grass cards from the shared foliage atlas (scripts/bake-foliage.py)
    const grass = new THREE.MeshLambertMaterial({ map: treeAtlas(this.biome.atlas), alphaTest: 0.5, side: THREE.DoubleSide });
    // the cards light like the turf under them: each tuft carries the ground normal (gNormal), and
    // the back faces keep it (three.js flips normals on double-sided back faces, which left half of
    // every tuft unlit: dark olive spikes)
    grass.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 gNormal;')
        .replace(
          '#include <defaultnormal_vertex>',
          '#include <defaultnormal_vertex>\nif (dot(gNormal, gNormal) > 0.5) transformedNormal = normalMatrix * gNormal;',
        );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        '#include <normal_fragment_begin>\nnormal = normalize(vNormal);',
      );
    };
    this.grassMat = preserveCoverage(patchMaterial(grass, { key: 'tuft3', wind: true }));
    this.grassMat.alphaToCoverage = true;
    this.flowerMat = this.grassMat;
    if (this.biome.shrubs > 0 || this.bankLife) {
      // mastic / lentisk / young holm oak: a round leafy bush (tree model, leaf clusters to the ground)
      this.shrub = broadleafGeometry(11, 0.0, 1.35);
      const sm = preserveCoverage(
        patchMaterial(new THREE.MeshLambertMaterial({ map: treeAtlas(this.biome.atlas), alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true }), {
          key: 'shrub',
          wind: true,
        }),
      );
      sm.alphaToCoverage = true;
      this.shrubMat = sm;
    }
    this.rockMat = patchMaterial(new THREE.MeshStandardMaterial({ color: 0x8b8a84, roughness: 0.95, flatShading: true }), {
      key: 'boulder',
    });
    // photo-scanned limestone (Poly Haven rock_07, decimated in Blender) once it has loaded
    void loadModel('rock_07.glb')
      .then((g) => {
        if (this.disposed) return;
        g.updateMatrixWorld(true);
        g.traverse((c) => {
          const m = c as THREE.Mesh;
          if (!m.isMesh) return;
          this.rock.dispose();
          this.rockMat.dispose();
          this.rock = m.geometry.clone().applyMatrix4(m.matrixWorld);
          // the decimated scan has hard creases: soften so boulders read as weathered stone
          this.rock.deleteAttribute('normal');
          this.rock = mergeVertices(this.rock, 0.02);
          this.rock.computeVertexNormals();
          // shared with the model cache: never disposed here
          // Gaisberg limestone is cool light grey; the scan is warmer
          const rm = (m.material as THREE.MeshStandardMaterial).clone();
          rm.color.copy(this.biome.rock);
          this.rockMat = patchMaterial(rm, { key: 'rockscan' });
        });
      })
      .catch(() => undefined);
    if (this.biome.palms > 0) {
      void loadModel('palm.glb')
        .then((g) => {
          if (this.disposed) return;
          g.updateMatrixWorld(true);
          // one glTF primitive per material: merge them into one geometry with groups
          const geos: THREE.BufferGeometry[] = [];
          const mats: THREE.Material[] = [];
          g.traverse((c) => {
            const m = c as THREE.Mesh;
            if (!m.isMesh) return;
            const geo = m.geometry.clone().applyMatrix4(m.matrixWorld);
            for (const k of Object.keys(geo.attributes)) if (!['position', 'normal'].includes(k)) geo.deleteAttribute(k);
            geos.push(geo.index ? geo.toNonIndexed() : geo);
            const mat = (m.material as THREE.Material).clone();
            (mat as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
            mats.push(patchMaterial(mat, { key: `palm:${mat.name}`, wind: true }));
          });
          if (geos.length) {
            this.palm = mergeGeometries(geos, true);
            this.palmMats = mats;
          }
        })
        .catch(() => undefined);
    }
    // Poly Haven fern_02 (CC0), decimated in Blender: forest-floor cover
    if (this.biome.ferns) void loadModel('fern.glb')
      .then((g) => {
        if (this.disposed) return;
        g.updateMatrixWorld(true);
        g.traverse((c) => {
          const m = c as THREE.Mesh;
          if (!m.isMesh || this.fern) return;
          this.fern = m.geometry.clone().applyMatrix4(m.matrixWorld);
          const fm = (m.material as THREE.MeshStandardMaterial).clone();
          fm.side = THREE.DoubleSide;
          fm.alphaTest = 0.5;
          this.fernMat = patchMaterial(fm, { key: 'fern', wind: true });
        });
      })
      .catch(() => undefined);
    if (this.biome.lawn || this.biome.streets || this.biome.suburb) {
      this.pathMat = pathMaterial(this.biome);
      for (const road of o.roads ?? []) {
        const w = PATH_WIDTH[road.kind];
        if (!w || road.pts.length < 4) continue;
        const id = this.pathLines.length;
        this.pathLines.push({ pts: road.pts, half: w / 2 });
        // 64 m grid cells over the line's points (a point every few metres: good enough to find the line near a chunk)
        const seen = new Set<number>();
        for (let i = 0; i < road.pts.length; i += 2) {
          const k = Math.floor(road.pts[i] / 64) * 100003 + Math.floor(road.pts[i + 1] / 64);
          if (seen.has(k)) continue;
          seen.add(k);
          let l = this.pathGrid.get(k);
          if (!l) this.pathGrid.set(k, (l = []));
          l.push(id);
        }
      }
    }
    for (const road of o.roads ?? []) {
      if (road.kind === 'path' || road.kind === 'footway') continue;
      const hw = road.width / 2 + 0.6;
      for (let i = 0; i + 3 < road.pts.length; i += 2) {
        const seg = this.roadSegs.length;
        this.roadSegs.push(road.pts[i], road.pts[i + 1], road.pts[i + 2], road.pts[i + 3], hw);
        const x0 = Math.min(road.pts[i], road.pts[i + 2]) - hw, x1 = Math.max(road.pts[i], road.pts[i + 2]) + hw;
        const z0 = Math.min(road.pts[i + 1], road.pts[i + 3]) - hw, z1 = Math.max(road.pts[i + 1], road.pts[i + 3]) + hw;
        for (let cz = Math.floor(z0 / 16); cz <= Math.floor(z1 / 16); cz++) {
          for (let cx = Math.floor(x0 / 16); cx <= Math.floor(x1 / 16); cx++) {
            const k = cx * 100003 + cz;
            let l = this.roadGrid.get(k);
            if (!l) this.roadGrid.set(k, (l = []));
            l.push(seg);
          }
        }
      }
    }
  }

  private onOtherRoad(x: number, z: number): boolean {
    const l = this.roadGrid.get(Math.floor(x / 16) * 100003 + Math.floor(z / 16));
    if (!l) return false;
    const s = this.roadSegs;
    for (const i of l) {
      const ax = s[i], az = s[i + 1], dx = s[i + 2] - ax, dz = s[i + 3] - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
      if (Math.hypot(x - ax - dx * t, z - az - dz * t) < s[i + 4]) return true;
    }
    return false;
  }

  update(s: number) {
    const { route } = this.o;
    const count = Math.floor(route.length / CHUNK) + 1;
    const wanted = new Map<number, number>(); // chunk → distance from rider
    const keep = new Set<number>();
    for (let off = -BEHIND - 2 * CHUNK; off <= AHEAD + 2 * CHUNK; off += CHUNK / 2) {
      let c = Math.floor((s + off) / CHUNK);
      if (route.loop) c = ((c % count) + count) % count;
      else if (c < 0 || c >= count) continue;
      keep.add(c);
      if (off >= -BEHIND && off <= AHEAD) wanted.set(c, Math.min(wanted.get(c) ?? Infinity, Math.abs(off)));
    }
    // build at most one chunk per frame, nearest first
    let best = -1;
    let bestD = Infinity;
    for (const [c, d] of wanted) {
      if (!this.chunks.has(c) && d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (best >= 0) this.build(best);
    for (const [c, chunk] of this.chunks) {
      if (!keep.has(c)) {
        for (const m of chunk.meshes) {
          this.remove(m);
          m.dispose();
          if (m.userData.ownGeometry) m.geometry.dispose();
        }
        if (chunk.paths) {
          this.remove(chunk.paths);
          chunk.paths.geometry.dispose();
        }
        this.chunks.delete(c);
      }
    }
  }

  private build(ci: number) {
    const { route, index, halfWidth, groundHeight, isWater } = this.o;
    const density = this.o.density ?? 1;
    const r = rng(ci * 7919 + 13);
    const grass: number[] = [];
    const flowers: number[] = [];
    const rocks: number[] = [];
    const ferns: number[] = [];
    const palms: number[] = [];
    const cushions: number[] = [];
    const stones: number[] = [];
    const B = this.biome;
    const i0 = Math.floor((ci * CHUNK) / route.step);
    const i1 = Math.min(route.n - 1, Math.floor(((ci + 1) * CHUNK) / route.step));
    for (let i = i0; i < i1; i++) {
      const h = route.heading[i];
      const fx = Math.sin(h), fz = -Math.cos(h);
      const rx = Math.cos(h), rz = Math.sin(h);
      for (const side of [-1, 1]) {
        // a mown park lawn is turf: only a few longer tufts along the edge and around the trees
        const tries = Math.round(120 * density * (B.suburb ? 0.14 : B.lawn || B.streets ? 0.05 : 1));
        for (let k = 0; k < tries; k++) {
          const u = r();
          // denser verge right next to the asphalt, patchier meadow further out
          const d = halfWidth + 0.55 + (u < 0.5 ? r() * 4.5 : 4.5 + r() * (REACH - 4.5));
          const t = r() * route.step;
          const x = route.x[i] + rx * d * side + fx * t;
          const z = route.z[i] + rz * d * side + fz * t;
          const near = index.nearest(x, z, halfWidth + 1.2);
          if (near.index >= 0 && near.dist < halfWidth + 0.5) continue;
          if (B.streets && d < halfWidth + STREET_LEDGE + 0.1) continue;
          if (this.onOtherRoad(x, z)) continue;
          if (isWater?.(x, z)) continue;
          const cover = this.o.coverAt?.(x, z) ?? 0;
          const canopy = this.o.canopyAt?.(x, z) ?? 0;
          // above a bare top only a few plants hold between the stones
          const bare = B.bareAbove === undefined ? 0 : Math.min(1, Math.max(0, (groundHeight(x, z) - B.bareAbove + 60) / 140)) * 0.9;
          if (((this.o.screeAt?.(x, z) ?? 0) > 0.5 || r() < bare) && d > halfWidth + 1.2) {
            if (r() < 0.012 * B.rockDensity) {
              const by = groundHeight(x, z);
              if (Number.isFinite(by)) rocks.push(x, by - 0.12, z, 0.3 + r() * 0.8, r() * 6.28, 0);
            }
            continue;
          }
          // forest floor: ferns and litter, little grass (the verge right at the road stays grassy)
          if (canopy > 0.5 && d > halfWidth + 1.6) {
            if (r() < 0.16 && this.fern) {
              const fy = groundHeight(x, z);
              if (Number.isFinite(fy)) ferns.push(x, fy - 0.05, z, 0.5 + r() * 0.7, r() * 6.28, 0);
            }
            if (r() < 0.85) continue;
          }
          if (B.suburb) {
            // suburban edge: nature strip and lawn, gardens behind them; coastal heath on the headlands
            const sy = groundHeight(x, z);
            if (!Number.isFinite(sy)) continue;
            const ssx = groundHeight(x + 1.5, z) - sy, ssz = groundHeight(x, z + 1.5) - sy;
            if (Math.hypot(ssx, ssz) / 1.5 > 0.7) {
              if (r() < 0.05 * (B.steepRocks ?? 0.4)) rocks.push(x, sy - 0.15, z, 0.4 + r() * 1.1, r() * 6.28, 0);
              continue;
            }
            if (cover === 2 || canopy > 0.5) {
              // garden shrubs now and then (hedges, bottlebrush)
              if (r() < 0.012 && d > halfWidth + 3) cushions.push(x, sy - 0.2, z, 0.7 + r() * 0.8, r() * 6.28, 1);
              continue;
            }
            if (cover === 1) {
              // lawn: palms along the park's edge, the odd long tuft at the kerb
              if (this.palm && d > halfWidth + 3 && d < halfWidth + 16 && r() < B.palms * 0.1) palms.push(x, sy - 0.05, z, 1.5 + r() * 0.9, r() * 6.28, 0);
              else if (d < halfWidth + 1.4 && r() < 0.08) grass.push(x, sy - 0.03, z, 0.3 + r() * 0.2, r() * 6.28, 0);
              continue;
            }
            // open ground (headland, dune, verge): low scrub and tussock, thicker up on the cliffs
            const heath = sy > 6 ? 1 : 0.35;
            const pk = r();
            if (pk < 0.1 * heath && d > halfWidth + 1.5) cushions.push(x, sy - 0.2, z, 0.9 + r() * 1.3, r() * 6.28, 1);
            else if (pk < 0.1 * heath + 0.22 * heath) grass.push(x, sy - 0.03, z, 0.6 + r() * 0.6, r() * 6.28, 0);
            else if (r() < 0.01 * B.rockDensity) rocks.push(x, sy - 0.18, z, 0.3 + r() * r() * 1.2, r() * 6.28, 0);
            continue;
          }
          // city street: pavement and cobbles; grass only on the lawns of parks (and the odd verge strip)
          if (B.streets && (cover !== 1 || r() < 0.4)) continue;
          // built-up: pavements and lawns rather than long grass
          if (cover === 2 && (d > halfWidth + 2.2 ? r() < 0.75 : r() < 0.45)) continue;
          const y = groundHeight(x, z);
          if (!Number.isFinite(y)) continue;
          const sx = groundHeight(x + 1.5, z) - y;
          const sz = groundHeight(x, z + 1.5) - y;
          const slope = Math.hypot(sx, sz) / 1.5;
          const alpine = Math.min(1, Math.max(0, (y - 1900) / 900));
          if (this.bankLife && y < 1700) {
            // cut banks and embankments: plants and small embedded stones up to ~60 degrees, only the steepest faces
            // are bare; cover gathers at the foot and along the top edge where the ground flattens
            if (slope > 1.73) {
              if (r() < (d < halfWidth + 3.5 ? 0.025 : 0.004)) stones.push(x, y - 0.1, z, 0.25 + r() * 0.5, r() * 6.28, 0);
              continue;
            }
            if (slope > 0.45) {
              const gl = Math.hypot(sx, sz) || 1;
              const ux = sx / gl, uz = sz / gl;
              const up = (groundHeight(x + ux * 3, z + uz * 3) - y) / 3;
              const dn = (y - groundHeight(x - ux * 3, z - uz * 3)) / 3;
              const edge = Number.isFinite(up) && Number.isFinite(dn) && (up < 0.4 || dn < 0.4);
              if (r() < 0.012 * (d < halfWidth + 3.5 ? 3 : 1)) stones.push(x, y - 0.1, z, 0.15 + r() * r() * 0.55, r() * 6.28, 0);
              if (r() > (edge ? 0.8 : 0.34)) continue;
              const pick = r();
              if (pick < 0.04 && this.shrub && d > halfWidth + 1.2) cushions.push(x, y - 0.12, z, 0.5 + r() * 0.7, r() * 6.28, 0);
              else if (pick < 0.1 && this.fern) ferns.push(x, y - 0.05, z, 0.4 + r() * 0.5, r() * 6.28, 0);
              else grass.push(x, y - 0.05, z, (edge ? 0.5 : 0.4) + r() * 0.45, r() * 6.28, -1);
              continue;
            }
          }
          if (slope > 0.75 || (slope > 0.45 && r() < 0.6)) {
            if (r() < 0.03 * (B.steepRocks ?? B.rockDensity)) rocks.push(x, y - 0.15, z, 0.4 + r() * (B.tussocks ? 0.6 : 1.3), r() * 6.28, 0);
            continue;
          }
          if (B.tussocks) {
            // garrigue: limestone boulders, carritx tussocks, rosemary/mastic cushions, fan palms
            if (r() < 0.012 * B.rockDensity) rocks.push(x, y - 0.18, z, 0.25 + r() * r() * 1.1, r() * 6.28, 0);
            const pick = r();
            if (pick < B.palms * 0.4 * (canopy > 0.3 ? 1.6 : 1) && d > halfWidth + 1.5) {
              // dwarf fan palms grow in clumps of 3–6
              const n = 3 + Math.floor(r() * 4);
              for (let k = 0; k < n; k++) {
                const px = x + (r() - 0.5) * 3.2, pz = z + (r() - 0.5) * 3.2;
                const py = groundHeight(px, pz);
                if (Number.isFinite(py)) palms.push(px, py - 0.05, pz, 0.6 + r() * 0.6, r() * 6.28, 0);
              }
              continue;
            }
            // under pines the understory is open: fewer shrubs, more palms
            if (pick < B.palms + B.shrubs * (canopy > 0.4 ? 0.35 : 1) && d > halfWidth + 1.2) {
              cushions.push(x, y - 0.2, z, 1.1 + r() * 1.5, r() * 6.28, 1);
              continue;
            }
            // carritx grows in clumps with bare ground between; under pines the floor is open
            const clump = Math.sin(x * 0.23 + Math.sin(z * 0.19) * 2.0) * Math.cos(z * 0.21 + x * 0.07);
            if (clump < -0.1 && r() < 0.85) continue;
            // open slopes are covered in carritx; under the pines it thins out
            if (r() < (canopy > 0.4 ? 0.85 : 0.25)) continue;
            const v = d < halfWidth + 1.2 ? 0.55 + r() * 0.25 : 0.75 + r() * 0.5;
            grass.push(x, y - 0.03, z, v, r() * 6.28, 0);
            continue;
          }
          if (alpine > 0.4 && r() < alpine * 0.008) rocks.push(x, y - 0.1, z, 0.3 + r() * 0.9, r() * 6.28, 0);
          // patchy meadow mask
          const patch = Math.sin(x * 0.11 + Math.sin(z * 0.07) * 2.0) * Math.cos(z * 0.09 + x * 0.03);
          if (d > halfWidth + 5 && patch < -0.35 && r() < 0.7) continue;
          // open meadows away from the verge are mown short: only scattered tufts
          if (cover === 1 && d > halfWidth + 4 && r() < 0.55) continue;
          if (alpine > 0.75 && r() < alpine * 0.6) continue;
          // mown verge next to the asphalt and grazed/mown meadows stay short
          const verge = d < halfWidth + 1.8;
          const short = verge || cover === 1 || cover === 2;
          // the verge is mown to a few centimetres in autumn: low tufts over the turf, not blades
          const sc = (verge ? 0.3 + r() * 0.22 : short ? 0.5 + r() * 0.35 : 0.7 + r() * 0.6) - alpine * 0.2;
          // October: only a few late flowers left
          const target = r() < 0.025 + (1 - alpine) * 0.015 ? flowers : grass;
          target.push(x, y, z, sc, r() * 6.28, alpine);
        }
      }
    }
    const meshes: THREE.InstancedMesh[] = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    const cityLawn = !!(this.biome.lawn || this.biome.streets);
    const tiltQ = new THREE.Quaternion();
    const tiltAxis = new THREE.Vector3();
    // the atlas grass is near-neutral; the biome sets the meadow colour
    const [lush, dry, pale] = this.biome.grass;
    const add = (
      geo: THREE.BufferGeometry, mat: THREE.Material, arr: number[], tall: number, shadow: boolean, tint: boolean, turf = false,
    ) => {
      const n = arr.length / 6;
      if (!n) return;
      if (turf) {
        // the ground normal under each tuft (the grass material lights the cards with it)
        const gn = new Float32Array(n * 3);
        for (let k = 0; k < n; k++) {
          const x = arr[k * 6], z = arr[k * 6 + 2];
          const dx = groundHeight(x + 1, z) - groundHeight(x - 1, z);
          const dz = groundHeight(x, z + 1) - groundHeight(x, z - 1);
          const v = new THREE.Vector3(-dx / 2, 1, -dz / 2);
          if (!Number.isFinite(v.x + v.z)) v.set(0, 1, 0);
          v.normalize().toArray(gn, k * 3);
        }
        geo = geo.clone();
        geo.setAttribute('gNormal', new THREE.InstancedBufferAttribute(gn, 3));
      }
      const mesh = new THREE.InstancedMesh(geo, mat, n);
      if (turf) mesh.userData.ownGeometry = true;
      for (let k = 0; k < n; k++) {
        const [x, y, z, sc, rot, flag] = arr.slice(k * 6, k * 6 + 6);
        // flag -1: a bank tuft, a shade darker than the meadow tufts it grows among
        const alpine = Math.max(flag, 0);
        q.setFromAxisAngle(up, rot);
        if (turf && cityLawn) {
          // no two clumps alike: width, height and lean vary, some are mirrored; a stamped row of one tuft reads as fake
          const h1 = (rot * 7.31) % 1, h2 = (rot * 13.17 + 0.37) % 1, h3 = (rot * 29.9 + 0.71) % 1;
          q.multiply(tiltQ.setFromAxisAngle(tiltAxis.set(Math.cos(rot * 5.0), 0, Math.sin(rot * 5.0)), (h3 - 0.5) * 0.5));
          m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sc * (0.6 + 0.9 * h1) * (h2 < 0.5 ? -1 : 1), sc * tall * (0.45 + 0.85 * h2), sc * (0.6 + 0.9 * h3)));
        } else m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sc, sc * tall, sc));
        mesh.setMatrixAt(k, m);
        if (tint && alpine === 1 && this.biome.shrubTint) {
          // shrub cushions (flag 1): their own green
          mesh.setColorAt(k, col.copy(this.biome.shrubTint).multiplyScalar(0.8 + 0.3 * ((rot * 7.3) % 1)));
        } else if (tint) {
          const v = (Math.sin(x * 0.21 + z * 0.13) + Math.sin(z * 0.17 - x * 0.05)) * 0.25 + 0.5;
          col.copy(lush).lerp(dry, v * 0.6).lerp(pale, alpine * 0.7).multiplyScalar((0.82 + 0.18 * ((rot * 13.7) % 1)) * (flag < 0 ? 0.74 : 1));
          // park and street lawns: the rough tufts range from dark green to bleached straw
          if (cityLawn) col.lerp(dry, ((rot * 3.3) % 1) * 0.8).multiplyScalar(0.7 + 0.45 * ((rot * 17.1) % 1));
          mesh.setColorAt(k, col);
        }
      }
      mesh.computeBoundingSphere();
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      meshes.push(mesh);
      this.add(mesh);
    };
    // Alpine tufts are wider than tall (tall cards read as spiky blades); carritx tussocks stand up
    add(this.tuft, this.grassMat, grass, this.biome.tussocks ? 1.25 : 0.82, false, true, true);
    if (cushions.length && this.shrub && this.shrubMat) add(this.shrub, this.shrubMat, cushions, 0.8, true, true);
    if (this.palm && this.palmMats) add(this.palm, this.palmMats as unknown as THREE.Material, palms, 1, true, false);
    add(this.flowerTuft, this.flowerMat, flowers, 1.0, false, true, true);
    add(this.rock, this.rockMat, rocks, 1, true, false);
    add(this.stone, this.stoneMat, stones, 1, true, false);
    if (this.fern && this.fernMat) add(this.fern, this.fernMat, ferns, 1, false, false);
    this.chunks.set(ci, { index: ci, meshes, paths: this.buildPaths(ci) });
  }

  /** Footpath ribbons within reach of a chunk, draped on the terrain, cut where they would run over the carriageway. */
  private buildPaths(ci: number): THREE.Mesh | undefined {
    if (!this.pathMat || !this.pathLines.length) return undefined;
    const { route, index, halfWidth, groundHeight } = this.o;
    const i0 = Math.floor((ci * CHUNK) / route.step);
    const i1 = Math.min(route.n - 1, Math.floor(((ci + 1) * CHUNK) / route.step));
    const M = 55;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = i0; i <= i1; i++) {
      x0 = Math.min(x0, route.x[i]);
      x1 = Math.max(x1, route.x[i]);
      z0 = Math.min(z0, route.z[i]);
      z1 = Math.max(z1, route.z[i]);
    }
    x0 -= M; x1 += M; z0 -= M; z1 += M;
    const ids = new Set<number>();
    for (let cz = Math.floor(z0 / 64); cz <= Math.floor(z1 / 64); cz++) {
      for (let cx = Math.floor(x0 / 64); cx <= Math.floor(x1 / 64); cx++) for (const id of this.pathGrid.get(cx * 100003 + cz) ?? []) ids.add(id);
    }
    if (!ids.size) return undefined;
    const clear = halfWidth + (this.biome.streets ? STREET_LEDGE : 0.6) + 0.2;
    const pos: number[] = [];
    const puv: number[] = [];
    const idx: number[] = [];
    const STEP = 3;
    for (const id of ids) {
      const { pts, half } = this.pathLines[id];
      // resample at ~3 m so the ribbon follows the terrain
      const px: number[] = [];
      const pz: number[] = [];
      for (let i = 0; i + 3 < pts.length; i += 2) {
        const ax = pts[i], az = pts[i + 1], dx = pts[i + 2] - ax, dz = pts[i + 3] - az;
        const n = Math.max(1, Math.round(Math.hypot(dx, dz) / STEP));
        for (let k = 0; k < n; k++) {
          px.push(ax + (dx * k) / n);
          pz.push(az + (dz * k) / n);
        }
      }
      px.push(pts[pts.length - 2]);
      pz.push(pts[pts.length - 1]);
      let run: number[] = []; // point indices of the current piece
      let along = 0;
      const flush = () => {
        if (run.length >= 2) {
          const base = pos.length / 3;
          let a = along;
          for (let r = 0; r < run.length; r++) {
            const j = run[r];
            const jp = run[Math.max(0, r - 1)], jn = run[Math.min(run.length - 1, r + 1)];
            let tx = px[jn] - px[jp], tz = pz[jn] - pz[jp];
            const tl = Math.hypot(tx, tz) || 1;
            tx /= tl;
            tz /= tl;
            if (r > 0) a += Math.hypot(px[j] - px[run[r - 1]], pz[j] - pz[run[r - 1]]);
            const nx = -tz, nz = tx;
            // Vienna: gravel inside parks (z < 0), paved sidewalk outside
            const park = this.biome.streets && (this.o.coverAt?.(px[j], pz[j]) ?? 0) === 1;
            const e = half + 0.06;
            for (const sgn of [-1, 1]) {
              const vx = px[j] + nx * e * sgn, vz = pz[j] + nz * e * sgn;
              const vy = groundHeight(vx, vz);
              pos.push(vx, Number.isFinite(vy) ? vy + 0.05 : NaN, vz);
              puv.push(sgn * e, a, park ? -half : half);
            }
          }
          for (let r = 0; r + 1 < run.length; r++) {
            const b = base + r * 2;
            const ys = [pos[b * 3 + 1], pos[(b + 1) * 3 + 1], pos[(b + 2) * 3 + 1], pos[(b + 3) * 3 + 1]];
            if (ys.every(Number.isFinite)) idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
          }
        }
        run = [];
        along += 1000;
      };
      for (let j = 0; j < px.length; j++) {
        const inBox = px[j] > x0 && px[j] < x1 && pz[j] > z0 && pz[j] < z1;
        const near = inBox ? index.nearest(px[j], pz[j], clear + 1) : null;
        const onRoad = !!near && near.index >= 0 && near.dist < clear;
        if (!inBox || onRoad) {
          flush();
          continue;
        }
        run.push(j);
      }
      flush();
    }
    if (!idx.length) return undefined;
    // unreachable (NaN) vertices are not referenced by any triangle, but keep the buffers finite
    for (let k = 1; k < pos.length; k += 3) if (!Number.isFinite(pos[k])) pos[k] = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('pathUv', new THREE.Float32BufferAttribute(puv, 3));
    const nor = new Float32Array(pos.length);
    for (let k = 1; k < nor.length; k += 3) nor[k] = 1;
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, this.pathMat);
    mesh.renderOrder = 1;
    mesh.receiveShadow = true;
    mesh.frustumCulled = true;
    this.add(mesh);
    return mesh;
  }

  dispose() {
    this.disposed = true;
    for (const chunk of this.chunks.values()) {
      for (const m of chunk.meshes) {
        m.dispose();
        if (m.userData.ownGeometry) m.geometry.dispose();
      }
      chunk.paths?.geometry.dispose();
    }
    this.chunks.clear();
    this.pathMat?.dispose();
    this.tuft.dispose();
    this.flowerTuft.dispose();
    this.cushion.dispose();
    this.shrub?.dispose();
    this.shrubMat?.dispose();
    this.rock.dispose();
    this.stone.dispose();
    this.stoneMat.dispose();
    this.grassMat.dispose();
    if (!this.sharedRockMat) this.rockMat.dispose();
    this.palm?.dispose();
    for (const m of [this.palmMats ?? []].flat()) m.dispose();
    this.fern?.dispose();
    this.fernMat?.dispose();
  }
}
