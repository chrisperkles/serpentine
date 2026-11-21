// Forest polygons from OSM → rasterised per route chunk → instanced spruce/beech trees
// with two LODs, bucketed spatially for culling.

import * as THREE from 'three';
import type { OsmWorld, Polygon } from '../geo/osm.ts';
import type { Route, RouteIndex } from '../geo/route.ts';
import { patchMaterial } from './atmosphere.ts';
import { mergeColored } from './Road.ts';
import { broadleafGeometry, pineGeometry, preserveCoverage, spruceGeometry, treeAtlas, treeAtlasReady } from './treeModels.ts';
import { ALPINE, type Biome } from './biome.ts';
import { impostorGeometry, renderImpostorAtlas } from './impostors.ts';
import { broadleafTint, coniferTint, dayOfYear, evergreenBroadTint, pineTint } from './season.ts';
import { pointAt } from '../geo/route.ts';
import type { BakedTrees } from '../geo/trees.ts';
import { WorldGroup } from './dispose.ts';

const BUCKET = 250;
const NEAR = 230;
const FAR = 6000;

interface Edges {
  e: Float32Array; // x0,z0,x1,z1 …
  bbox: [number, number, number, number];
  kind: number; // 1 needle, 2 broad, 3 mixed, 0 = exclusion
}

function edgesOf(p: Polygon, kind: number): Edges {
  const rings = [p.outer, ...p.holes];
  let count = 0;
  for (const r of rings) count += r.length / 2;
  const e = new Float32Array(count * 4);
  let k = 0;
  for (const r of rings) {
    const n = r.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      e[k++] = r[i * 2];
      e[k++] = r[i * 2 + 1];
      e[k++] = r[j * 2];
      e[k++] = r[j * 2 + 1];
    }
  }
  return { e, bbox: p.bbox, kind };
}

function fillPolygon(
  mask: Uint8Array, W: number, H: number, gx: number, gz: number, cell: number, poly: Edges,
) {
  const [bx0, bz0, bx1, bz1] = poly.bbox;
  const r0 = Math.max(0, Math.floor((bz0 - gz) / cell));
  const r1 = Math.min(H - 1, Math.ceil((bz1 - gz) / cell));
  if (r0 > r1 || bx1 < gx || bx0 > gx + W * cell) return;
  const xs: number[] = [];
  const e = poly.e;
  for (let r = r0; r <= r1; r++) {
    const zc = gz + (r + 0.5) * cell;
    xs.length = 0;
    for (let k = 0; k < e.length; k += 4) {
      const z0 = e[k + 1];
      const z1 = e[k + 3];
      if ((z0 <= zc && z1 > zc) || (z1 <= zc && z0 > zc)) {
        xs.push(e[k] + ((zc - z0) * (e[k + 2] - e[k])) / (z1 - z0));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    for (let s = 0; s + 1 < xs.length; s += 2) {
      const c0 = Math.max(0, Math.ceil((xs[s] - gx) / cell - 0.5));
      const c1 = Math.min(W - 1, Math.floor((xs[s + 1] - gx) / cell - 0.5));
      for (let c = c0; c <= c1; c++) mask[r * W + c] = poly.kind;
    }
  }
}

function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function coniferGeometry(lod: 0 | 1): THREE.BufferGeometry {
  // neutral: species/season colour comes from the instance tint, matching the near cards
  const green = new THREE.Color(0.3, 0.32, 0.29);
  const dark = new THREE.Color(0.24, 0.26, 0.23);
  const bark = new THREE.Color(0.24, 0.17, 0.12);
  if (lod === 1) {
    return softenNormals(mergeColored([[new THREE.ConeGeometry(0.21, 0.8, 6, 1).translate(0, 0.58, 0), green]]));
  }
  const seg = 8;
  const tiers: [number, number, number][] = [
    [0.17, 0.42, 0.1],
    [0.14, 0.38, 0.32],
    [0.1, 0.34, 0.54],
    [0.06, 0.26, 0.76],
  ];
  const parts: [THREE.BufferGeometry, THREE.Color][] = [
    [new THREE.CylinderGeometry(0.005, 0.01, 0.3, 5, 1, true).translate(0, 0.15, 0), bark],
  ];
  tiers.forEach(([r, h, base], i) =>
    parts.push([new THREE.ConeGeometry(r, h, seg, 1, true).translate(0, base + h / 2, 0), i % 2 ? dark : green]),
  );
  return softenNormals(mergeColored(parts));
}

function broadGeometry(lod: 0 | 1): THREE.BufferGeometry {
  const leaf = new THREE.Color(0.36, 0.37, 0.33);
  const leaf2 = new THREE.Color(0.3, 0.31, 0.28);
  const bark = new THREE.Color(0.3, 0.28, 0.25);
  if (lod === 1) {
    return softenNormals(
      mergeColored([[new THREE.IcosahedronGeometry(0.3, 0).scale(1, 0.85, 1).translate(0, 0.62, 0), leaf]]),
    );
  }
  const blob = (r: number, x: number, y: number, z: number, seed: number) => {
    const g = new THREE.IcosahedronGeometry(r, 2);
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.set(p.getX(i), p.getY(i), p.getZ(i));
      // low-frequency lumps keyed on direction so shared corners stay welded
      const lump = Math.sin(v.x * 31 + seed) * Math.sin(v.y * 27 + seed * 2) * Math.sin(v.z * 29 - seed);
      const s = 1 + lump * 0.12;
      n.setXYZ(i, v.x / r, v.y / r, v.z / r);
      p.setXYZ(i, v.x * s, v.y * s * 0.9, v.z * s);
    }
    return g.translate(x, y, z);
  };
  return softenNormals(
    mergeColored([
      [new THREE.CylinderGeometry(0.007, 0.013, 0.56, 5, 1, true).translate(0, 0.28, 0), bark],
      [blob(0.26, 0, 0.62, 0, 1), leaf],
      [blob(0.18, 0.12, 0.78, 0.05, 2), leaf2],
      [blob(0.17, -0.1, 0.72, -0.08, 3), leaf],
    ]),
  );
}

/** Tilt normals upward so foliage reads soft instead of faceted. */
function softenNormals(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.getAttribute('normal');
  const v = new THREE.Vector3();
  for (let i = 0; i < n.count; i++) {
    v.set(n.getX(i), n.getY(i) + 0.7, n.getZ(i)).normalize();
    n.setXYZ(i, v.x, v.y, v.z);
  }
  return g;
}

interface Bucket {
  cx: number;
  cz: number;
  near: THREE.InstancedMesh[];
  far: THREE.InstancedMesh[];
}

export interface VegetationOptions {
  corridor: number;
  spacing: number;
  roadHalfWidth: number;
  heightAt: (x: number, z: number) => number;
  /** The DEM before road cuts and fills; trees whose ground the road works moved are left out. */
  rawHeightAt?: (x: number, z: number) => number;
  /** Real trees from a canopy height model; replaces OSM forest polygons when present. */
  baked?: BakedTrees | null;
  /** Day of year for foliage colour (defaults to today). */
  day?: number;
  /** Needed to render the distant-tree impostors. */
  renderer?: THREE.WebGLRenderer;
  biome?: Biome;
}

// near-LOD variants: forest-grown (high crown base) and open/edge-grown (foliage to the ground)
type Kind = 'spruceF' | 'spruceO' | 'beechF' | 'beechO';
const KINDS: Kind[] = ['spruceF', 'spruceO', 'beechF', 'beechO'];
const STRIDE = 9; // x, y, z, width, height, rot, r, g, b

export class Vegetation extends WorldGroup {
  private buckets: Bucket[] = [];
  count = 0;

  constructor(route: Route, index: RouteIndex, osm: OsmWorld, o: VegetationOptions) {
    super();
    const day = o.day ?? dayOfYear();
    const blockers = [
      ...osm.water.map((p) => edgesOf(p, 0)),
      ...osm.buildings.map((b) => edgesOf({ outer: b.ring, holes: [], bbox: ringBox(b.ring) }, 0)),
    ];
    const lists = new Map<string, Record<Kind, number[]>>();
    const tint = new THREE.Color();
    const add = (kind: Kind, x: number, y: number, z: number, w: number, h: number, rot: number, c: THREE.Color) => {
      const key = `${Math.floor(x / BUCKET)},${Math.floor(z / BUCKET)}`;
      let l = lists.get(key);
      if (!l) lists.set(key, (l = { spruceF: [], spruceO: [], beechF: [], beechO: [] }));
      l[kind].push(x, y, z, w, h, rot, c.r, c.g, c.b);
    };

    if (o.baked) this.placeBaked(route, index, osm, o, blockers, add, day, tint);
    else this.placeFromOsm(route, index, osm, o, blockers, add, day, tint);

    const biome = o.biome ?? ALPINE;
    // Alpine: spruce + beech; Mediterranean: Aleppo pine + holm oak / wild olive
    const near: Record<Kind, THREE.BufferGeometry> =
      biome.conifer === 'pine'
        ? {
          spruceF: pineGeometry(1, 0.7, 0.85),
          spruceO: pineGeometry(5, 0.52, 1.05),
          beechF: broadleafGeometry(2, 0.34, 1.0),
          beechO: broadleafGeometry(9, 0.24, 1.2),
        }
        : {
          spruceF: spruceGeometry(1, 0.36),
          spruceO: spruceGeometry(5, 0.07),
          beechF: broadleafGeometry(2, 0.44, 0.9),
          beechO: broadleafGeometry(9, 0.22, 1.2),
        };
    // distant trees: impostor cards rendered from the near models (fallback: simple solids)
    const far: Record<Kind, THREE.BufferGeometry> = o.renderer
      ? {
        spruceF: impostorGeometry(0, 4),
        spruceO: impostorGeometry(1, 4),
        beechF: impostorGeometry(2, 4),
        beechO: impostorGeometry(3, 4),
      }
      : { spruceF: coniferGeometry(1), spruceO: coniferGeometry(1), beechF: broadGeometry(1), beechO: broadGeometry(1) };
    const atlas = treeAtlas(biome.atlas);
    const nearMat = preserveCoverage(
      patchMaterial(new THREE.MeshLambertMaterial({ map: atlas, alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true }), {
        key: `treecard2:${biome.id}`,
        wind: true,
      }),
      2048,
      biome.conifer === 'pine' ? 0.15 : 0.3,
    );
    nearMat.alphaToCoverage = true;
    const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
    blank.needsUpdate = true;
    const farMat = o.renderer
      ? preserveCoverage(
        patchMaterial(new THREE.MeshLambertMaterial({ map: blank, alphaTest: 0.5, side: THREE.DoubleSide }), {
          key: 'impostor',
          wind: true,
        }),
        512,
      )
      : patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), { key: 'tree', wind: true });
    if (o.renderer) {
      farMat.alphaToCoverage = true;
      const renderer = o.renderer;
      void treeAtlasReady(biome.atlas).then((tex) => {
        if (this.disposed) return;
        farMat.map = renderImpostorAtlas(renderer, [near.spruceF, near.spruceO, near.beechF, near.beechO], tex);
        farMat.needsUpdate = true;
        blank.dispose();
      });
    }
    const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: atlas, alphaTest: 0.5 });
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    for (const [key, l] of lists) {
      const [bx, bz] = key.split(',').map(Number);
      const bucket: Bucket = { cx: (bx + 0.5) * BUCKET, cz: (bz + 0.5) * BUCKET, near: [], far: [] };
      for (const kind of KINDS) {
        const arr = l[kind];
        const n = arr.length / STRIDE;
        if (!n) continue;
        const matrices = new THREE.InstancedBufferAttribute(new Float32Array(n * 16), 16);
        const colors = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
        for (let i = 0; i < n; i++) {
          const k = i * STRIDE;
          q.setFromAxisAngle(up, arr[k + 5]);
          m.compose(pos.set(arr[k], arr[k + 1], arr[k + 2]), q, scl.set(arr[k + 3], arr[k + 4], arr[k + 3]));
          m.toArray(matrices.array, i * 16);
          colors.array[i * 3] = arr[k + 6];
          colors.array[i * 3 + 1] = arr[k + 7];
          colors.array[i * 3 + 2] = arr[k + 8];
        }
        for (const lod of [0, 1] as const) {
          const mesh = new THREE.InstancedMesh(lod === 0 ? near[kind] : far[kind], lod === 0 ? nearMat : farMat, n);
          mesh.instanceMatrix = matrices;
          mesh.instanceColor = colors;
          mesh.computeBoundingSphere();
          mesh.castShadow = lod === 0;
          if (lod === 0) mesh.customDepthMaterial = depthMat;
          mesh.receiveShadow = false;
          mesh.visible = false;
          (lod === 0 ? bucket.near : bucket.far).push(mesh);
          this.add(mesh);
        }
        this.count += n;
      }
      this.buckets.push(bucket);
    }
  }

  /** Trees at their real positions and heights (canopy height model). */
  private placeBaked(
    route: Route, index: RouteIndex, osm: OsmWorld, o: VegetationOptions, blockers: Edges[],
    add: (k: Kind, x: number, y: number, z: number, w: number, h: number, rot: number, c: THREE.Color) => void,
    day: number, tint: THREE.Color,
  ) {
    const t = o.baked!;
    const hw = o.roadHalfWidth;
    // blocker mask (buildings, water, other roads) over the whole corridor at 2 m
    const [bx0, bz0, bx1, bz1] = route.bounds;
    const cell = 2;
    const x0 = bx0 - o.corridor, z0 = bz0 - o.corridor;
    const W = Math.ceil((bx1 - bx0 + 2 * o.corridor) / cell);
    const H = Math.ceil((bz1 - bz0 + 2 * o.corridor) / cell);
    const mask = new Uint8Array(W * H);
    for (const f of blockers) fillPolygon(mask, W, H, x0, z0, cell, { ...f, kind: 1 });
    for (const road of osm.roads) {
      if (road.kind === 'path' || road.kind === 'footway' || road.kind === 'track') continue;
      markRoad(mask, W, H, x0, z0, cell, road.pts, road.width / 2 + 0.8);
    }
    for (let i = 0; i < t.n; i++) {
      let x = t.x[i];
      let z = t.z[i];
      const h = t.h[i];
      if (h < 3) continue;
      const near = index.nearest(x, z, o.corridor);
      if (near.index < 0) continue;
      if (near.turn && near.dist < hw + 1.6) continue;
      // tree tops over the road edge: the trunk stands beside the asphalt, the crown overhangs
      if (near.dist < hw + 1.6) {
        const p = pointAt(route, near.f * route.step);
        const dx = x - p.x, dz = z - p.z;
        const d = Math.hypot(dx, dz) || 1;
        x = p.x + (dx / d) * (hw + 1.6 + (i % 3) * 0.4);
        z = p.z + (dz / d) * (hw + 1.6 + (i % 3) * 0.4);
      }
      const mx = Math.floor((x - x0) / cell), mz = Math.floor((z - z0) / cell);
      if (mx >= 0 && mz >= 0 && mx < W && mz < H && mask[mz * W + mx]) continue;
      const y = o.heightAt(x, z);
      if (!Number.isFinite(y)) continue;
      // a cut took the tree's ground away, or a fill buried it: it hung in the air above the slope
      const raw = o.rawHeightAt?.(x, z) ?? y;
      if (Math.abs(raw - y) > 1.5) continue;
      const r1 = hash2(i, 17), r2 = hash2(i, 29);
      const conifer = t.kind[i] === 1;
      // forest edges along the road keep their lower branches, like open-grown trees
      // park trees stand apart on lawns: every one grows the wide, low crown of an open-grown tree
      const edge = t.open[i] === 1 || near.dist < hw + 14 || o.biome?.lawn === true;
      const cr = t.crown[i];
      const med = o.biome?.evergreen === true;
      if (conifer) {
        const larch = !med && r2 < 0.1 && y > 800;
        if (med) pineTint(r1, tint);
        else coniferTint(day, y, r1, larch, tint);
        // pines: crowns as wide as the canopy model says (open, umbrella-like)
        const w = med ? Math.min(Math.max(cr / 0.3, h * 0.45), h * 1.1) : Math.min(Math.max(cr / 0.24, h * 0.42), h * 0.95);
        add(edge ? 'spruceO' : 'spruceF', x, y - 0.4, z, w, h * (larch ? 0.92 : 1), r1 * 6.283, tint);
      } else {
        if (med) evergreenBroadTint(r1, tint);
        else broadleafTint(day, y, r1, tint);
        // irregular crowns: some taller and narrower, some squat
        // park elms, planes and oaks spread nearly as wide as they are tall and meet over the drive
        const lo = o.biome?.lawn ? 0.66 : 0.5;
        const w = Math.min(Math.max(cr / 0.3, h * lo), h * 1.25) * (0.8 + hash2(i, 41) * 0.4);
        add(edge ? 'beechO' : 'beechF', x, y - 0.3, z, w, h, r2 * 6.283, tint);
      }
    }
  }

  /** Fallback: fill OSM forest polygons on a jittered grid. */
  private placeFromOsm(
    route: Route, index: RouteIndex, osm: OsmWorld, o: VegetationOptions, blockers: Edges[],
    add: (k: Kind, x: number, y: number, z: number, w: number, h: number, rot: number, c: THREE.Color) => void,
    day: number, tint: THREE.Color,
  ) {
    const forests = osm.forests.map((p) => edgesOf(p, p.leaf === 'needle' ? 1 : p.leaf === 'broad' ? 2 : 3));
    const cell = o.spacing;
    const chunkLen = Math.round(1500 / route.step);
    for (let a = 0; a < route.n - 1; a += chunkLen) {
      const b = Math.min(route.n, a + chunkLen);
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (let i = a; i < b; i++) {
        x0 = Math.min(x0, route.x[i]);
        x1 = Math.max(x1, route.x[i]);
        z0 = Math.min(z0, route.z[i]);
        z1 = Math.max(z1, route.z[i]);
      }
      x0 -= o.corridor; z0 -= o.corridor; x1 += o.corridor; z1 += o.corridor;
      const W = Math.ceil((x1 - x0) / cell);
      const H = Math.ceil((z1 - z0) / cell);
      const mask = new Uint8Array(W * H);
      const overlaps = (bb: [number, number, number, number]) => bb[2] >= x0 && bb[0] <= x1 && bb[3] >= z0 && bb[1] <= z1;
      for (const f of forests) if (overlaps(f.bbox)) fillPolygon(mask, W, H, x0, z0, cell, f);
      for (const f of blockers) if (overlaps(f.bbox)) fillPolygon(mask, W, H, x0, z0, cell, f);
      for (const road of osm.roads) clearRoad(mask, W, H, x0, z0, cell, road.pts, road.width / 2 + 1.5);

      for (let r = 0; r < H; r++) {
        for (let c = 0; c < W; c++) {
          const kind = mask[r * W + c];
          if (!kind) continue;
          const gx = Math.floor(x0 / cell) + c;
          const gz = Math.floor(z0 / cell) + r;
          const jx = hash2(gx, gz) - 0.5;
          const jz = hash2(gz + 11, gx - 7) - 0.5;
          const x = x0 + (c + 0.5 + jx * 0.8) * cell;
          const z = z0 + (r + 0.5 + jz * 0.8) * cell;
          const near = index.nearest(x, z, o.corridor);
          if (near.index < a || near.index >= b) continue;
          if (near.dist < o.roadHalfWidth + 4.5) continue;
          const keep = hash2(gx * 3 + 1, gz * 5 + 2);
          if (near.dist > 160 && keep > 0.55) continue;
          const y = o.heightAt(x, z);
          if (!Number.isFinite(y)) continue;
          const pick = hash2(gx + 101, gz - 33);
          const lowland = route.category === 'city' || route.category === 'flat' ? 0.4 : 1;
          const coniferShare = kind === 1 ? 1 : kind === 2 ? 0 : (y > 1100 ? 0.85 : y > 700 ? 0.6 : 0.4) * (y > 700 ? 1 : lowland);
          const conifer = pick < coniferShare;
          const altitudeShrink = Math.min(1, Math.max(0.45, 1 - (y - 1500) / 1400));
          const h = (conifer ? 17 + keep * 15 : 11 + keep * 11) * altitudeShrink;
          const edge = near.dist < o.roadHalfWidth + 14;
          if (conifer) {
            coniferTint(day, y, keep, pick < 0.04 && y > 800, tint);
            add(edge ? 'spruceO' : 'spruceF', x, y - 0.6, z, h * 0.62, h, pick * 6.283, tint);
          } else {
            broadleafTint(day, y, keep, tint);
            add(edge ? 'beechO' : 'beechF', x, y - 0.6, z, h * 0.8, h, pick * 6.283, tint);
          }
        }
      }
    }
    for (let i = 0; i < osm.trees.length; i += 2) {
      const x = osm.trees[i];
      const z = osm.trees[i + 1];
      const near = index.nearest(x, z, o.corridor);
      if (near.index < 0 || near.dist < o.roadHalfWidth + 1.5) continue;
      const y = o.heightAt(x, z);
      if (!Number.isFinite(y)) continue;
      const h = 12 + hash2(i, 3) * 8;
      broadleafTint(day, y, hash2(i, 7), tint);
      add('beechO', x, y - 0.3, z, h * 0.9, h, hash2(i, 5) * 6.283, tint);
    }
  }

  /** Trees within r metres, normalised to 0..1 (1 ≈ closed forest). */
  densityAt(x: number, z: number, r = 90): number {
    let n = 0;
    for (const b of this.buckets) {
      if (Math.abs(b.cx - x) > r + BUCKET || Math.abs(b.cz - z) > r + BUCKET) continue;
      for (const m of b.near) n += m.count;
    }
    return Math.min(1, n / ((Math.PI * (r + BUCKET / 2) ** 2) / 45));
  }

  update(cam: THREE.Vector3, range = 1) {
    const nearD = NEAR * range;
    const farD = FAR * range;
    for (const b of this.buckets) {
      const d = Math.hypot(b.cx - cam.x, b.cz - cam.z) - BUCKET * 0.7;
      const near = d < nearD;
      const far = !near && d < farD;
      for (const m of b.near) m.visible = near;
      for (const m of b.far) m.visible = far;
    }
  }
}

function ringBox(r: Float32Array): [number, number, number, number] {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (let i = 0; i < r.length; i += 2) {
    a = Math.min(a, r[i]);
    c = Math.max(c, r[i]);
    b = Math.min(b, r[i + 1]);
    d = Math.max(d, r[i + 1]);
  }
  return [a, b, c, d];
}

function clearRoad(
  mask: Uint8Array, W: number, H: number, gx: number, gz: number, cell: number, pts: Float32Array, hw: number,
) {
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i], az = pts[i + 1], bx = pts[i + 2], bz = pts[i + 3];
    const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - hw - gx) / cell));
    const c1 = Math.min(W - 1, Math.ceil((Math.max(ax, bx) + hw - gx) / cell));
    const r0 = Math.max(0, Math.floor((Math.min(az, bz) - hw - gz) / cell));
    const r1 = Math.min(H - 1, Math.ceil((Math.max(az, bz) + hw - gz) / cell));
    if (c0 > c1 || r0 > r1) continue;
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz || 1;
    for (let r = r0; r <= r1; r++) {
      const pz = gz + (r + 0.5) * cell;
      for (let c = c0; c <= c1; c++) {
        const px = gx + (c + 0.5) * cell;
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2));
        if (Math.hypot(px - ax - dx * t, pz - az - dz * t) < hw) mask[r * W + c] = 0;
      }
    }
  }
}

/** Mark road corridors as blocked (inverse of clearRoad). */
function markRoad(
  mask: Uint8Array, W: number, H: number, gx: number, gz: number, cell: number, pts: Float32Array, hw: number,
) {
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i], az = pts[i + 1], bx = pts[i + 2], bz = pts[i + 3];
    const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - hw - gx) / cell));
    const c1 = Math.min(W - 1, Math.ceil((Math.max(ax, bx) + hw - gx) / cell));
    const r0 = Math.max(0, Math.floor((Math.min(az, bz) - hw - gz) / cell));
    const r1 = Math.min(H - 1, Math.ceil((Math.max(az, bz) + hw - gz) / cell));
    if (c0 > c1 || r0 > r1) continue;
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz || 1;
    for (let r = r0; r <= r1; r++) {
      const pz = gz + (r + 0.5) * cell;
      for (let c = c0; c <= c1; c++) {
        const px = gx + (c + 0.5) * cell;
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2));
        if (Math.hypot(px - ax - dx * t, pz - az - dz * t) < hw) mask[r * W + c] = 1;
      }
    }
  }
}
