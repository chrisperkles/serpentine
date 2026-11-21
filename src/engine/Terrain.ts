// Streaming quadtree terrain on slippy-map tiles: Terrarium DEM for height,
// orthophoto mosaics for colour. Leaves split by camera distance; parents stay visible
// until all four children are ready, skirts hide LOD cracks.

import * as THREE from 'three';
import { DEM_MAX_Z, heightAtMerc, heightAtMercSmooth, loadDem } from '../geo/elevation.ts';
import { loadImageryTile, type ImagerySource } from '../geo/imagery.ts';
import { tileBoundsMerc, type WorldFrame } from '../geo/mercator.ts';
import { pointAt, type Route, type RouteIndex } from '../geo/route.ts';
import { terrainMaterial } from './terrainMaterial.ts';
import { UNDERPASS_HALF, UNDERPASS_SIDE } from './Tunnel.ts';

const SEG = 64;
const VERTS = (SEG + 1) * (SEG + 1);
const SKIRT = 4 * SEG;
const MAX_Z = 18;
const FLATTEN_Z = 16;

const EMPTY = 0, LOADING = 1, READY = 2, FAILED = 3;

let sharedIndex: THREE.BufferAttribute | null = null;
let sharedUv: THREE.BufferAttribute | null = null;

function borderLoop(): number[] {
  const loop: number[] = [];
  for (let i = 0; i < SEG; i++) loop.push(i); // north edge, west→east
  for (let j = 0; j < SEG; j++) loop.push(j * (SEG + 1) + SEG); // east edge, north→south
  for (let i = SEG; i > 0; i--) loop.push(SEG * (SEG + 1) + i); // south edge, east→west
  for (let j = SEG; j > 0; j--) loop.push(j * (SEG + 1)); // west edge, south→north
  return loop;
}
const LOOP = borderLoop();

function getShared() {
  if (!sharedIndex) {
    const idx: number[] = [];
    for (let j = 0; j < SEG; j++) {
      for (let i = 0; i < SEG; i++) {
        const a = j * (SEG + 1) + i;
        const b = a + 1;
        const c = a + SEG + 1;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    for (let k = 0; k < SKIRT; k++) {
      const p0 = LOOP[k];
      const p1 = LOOP[(k + 1) % SKIRT];
      const s0 = VERTS + k;
      const s1 = VERTS + ((k + 1) % SKIRT);
      idx.push(p0, p1, s0, p1, s1, s0);
    }
    sharedIndex = new THREE.BufferAttribute(new Uint16Array(idx), 1);
    const uv = new Float32Array((VERTS + SKIRT) * 2);
    for (let j = 0; j <= SEG; j++) {
      for (let i = 0; i <= SEG; i++) {
        const v = j * (SEG + 1) + i;
        uv[v * 2] = i / SEG;
        uv[v * 2 + 1] = 1 - j / SEG;
      }
    }
    for (let k = 0; k < SKIRT; k++) {
      uv[(VERTS + k) * 2] = uv[LOOP[k] * 2];
      uv[(VERTS + k) * 2 + 1] = uv[LOOP[k] * 2 + 1];
    }
    sharedUv = new THREE.BufferAttribute(uv, 2);
  }
  return { index: sharedIndex, uv: sharedUv! };
}

class Node {
  z: number;
  x: number;
  y: number;
  parent: Node | null;
  children: Node[] | null = null;
  state = EMPTY;
  mesh: THREE.Mesh | null = null;
  abort: AbortController | null = null;
  // world bounds
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minH: number;
  maxH: number;
  size: number;
  mb: [number, number, number, number];

  constructor(frame: WorldFrame, z: number, x: number, y: number, parent: Node | null) {
    this.z = z;
    this.x = x;
    this.y = y;
    this.parent = parent;
    this.mb = tileBoundsMerc(z, x, y);
    const [mx0, my0, mx1, my1] = this.mb;
    this.minX = (mx0 - frame.mx0) * frame.k;
    this.maxX = (mx1 - frame.mx0) * frame.k;
    this.minZ = -(my1 - frame.my0) * frame.k;
    this.maxZ = -(my0 - frame.my0) * frame.k;
    this.size = this.maxX - this.minX;
    this.minH = parent ? parent.minH : 0;
    this.maxH = parent ? parent.maxH : 4000;
  }

  distanceTo(p: THREE.Vector3): number {
    const dx = Math.max(this.minX - p.x, 0, p.x - this.maxX);
    const dz = Math.max(this.minZ - p.z, 0, p.z - this.maxZ);
    const dy = Math.max(this.minH - p.y, 0, p.y - this.maxH);
    return Math.hypot(dx, dy, dz);
  }
}

export interface TerrainOptions {
  frame: WorldFrame;
  route: Route;
  routeIndex: RouteIndex;
  roadHalfWidth: number;
  sources: ImagerySource[];
  anisotropy: number;
  /** LOD aggressiveness: tiles split when camera distance < size * detail. */
  detail?: number;
  maxConcurrent?: number;
  /** Width (m) over which the hillside above the road falls to road level: 14 = grassy
   * embankment (Alps), ~3 = near-vertical rock cut (Mallorca). */
  cutWidth?: number;
  /**
   * How far (m) the drawn mesh lies under the asphalt. The coarse mesh interpolates between vertices that follow the
   * road's profile, so at a crest it rises through a road that only floats 0.45 m above it (a pale terrain band across
   * the lanes in Sydney); city routes sink it further. groundHeight keeps 0.45 so placed objects do not move.
   */
  roadSink?: number;
}

export class Terrain extends THREE.Group {
  private opts: Required<TerrainOptions>;
  /** Where the road passes under itself: the lower road's centre, direction and floor height. */
  private underpasses: { x: number; z: number; fx: number; fz: number; floor: number }[];
  private roots: Node[] = [];
  private active = 0;
  private queue: { node: Node; d: number }[] = [];
  private frame = 0;
  private fallbackTex: THREE.Texture;
  /** Number of tiles currently loading or queued near the camera. */
  pendingNear = 0;
  visibleTiles = 0;

  constructor(opts: TerrainOptions) {
    super();
    this.opts = { detail: 2.3, maxConcurrent: 14, cutWidth: 14, roadSink: 0.45, ...opts };
    this.underpasses = opts.route.underpasses.map((u) => {
      const p = pointAt(opts.route, u.s);
      return { x: p.x, z: p.z, fx: Math.sin(p.heading), fz: -Math.cos(p.heading), floor: p.ele - 0.45 };
    });
    const data = new Uint8Array([86, 100, 70, 255]);
    this.fallbackTex = new THREE.DataTexture(data, 1, 1);
    this.fallbackTex.colorSpace = THREE.SRGBColorSpace;
    this.fallbackTex.needsUpdate = true;

    // roots: z8 tiles around the route with a generous horizon margin
    const ROOT_Z = 8;
    const { frame, route } = opts;
    const [bx0, bz0, bx1, bz1] = route.bounds;
    const margin = 45000;
    const toTile = (wx: number, wz: number) => {
      const mx = wx / frame.k + frame.mx0;
      const my = -wz / frame.k + frame.my0;
      const n = 2 ** ROOT_Z;
      const M = Math.PI * 6378137;
      return [Math.floor(((mx + M) / (2 * M)) * n), Math.floor(((M - my) / (2 * M)) * n)];
    };
    const [tx0, ty0] = toTile(bx0 - margin, bz0 - margin);
    const [tx1, ty1] = toTile(bx1 + margin, bz1 + margin);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) this.roots.push(new Node(frame, ROOT_Z, tx, ty, null));
    }
  }

  setDetail(detail: number) {
    this.opts.detail = detail;
  }

  update(camera: THREE.Camera) {
    this.frame++;
    this.queue.length = 0;
    this.pendingNear = 0;
    this.visibleTiles = 0;
    const p = camera.position;
    for (const r of this.roots) this.visit(r, p);
    this.queue.sort((a, b) => a.d - b.d);
    for (const { node } of this.queue) {
      if (this.active >= this.opts.maxConcurrent) break;
      if (node.state === EMPTY) void this.load(node);
    }
  }

  private visit(node: Node, cam: THREE.Vector3) {
    const d = node.distanceTo(cam);
    const k = this.opts.detail * (node.children ? 1.12 : 1);
    const wantSplit = node.z < MAX_Z && d < node.size * k;

    if (node.state !== READY && node.state !== FAILED) {
      if (node.state === EMPTY) this.queue.push({ node, d });
      if (d < 3000) this.pendingNear++;
    }

    if (wantSplit && node.state === READY) {
      if (!node.children) {
        node.children = [0, 1, 2, 3].map(
          (q) => new Node(this.opts.frame, node.z + 1, node.x * 2 + (q & 1), node.y * 2 + (q >> 1), node),
        );
        for (const c of node.children) {
          c.minH = node.minH;
          c.maxH = node.maxH;
        }
      }
      const ready = node.children.every((c) => c.state === READY || c.state === FAILED);
      if (ready) {
        if (node.mesh) node.mesh.visible = false;
        for (const c of node.children) this.visit(c, cam);
        return;
      }
      for (const c of node.children) {
        if (c.state === EMPTY) this.queue.push({ node: c, d: c.distanceTo(cam) });
        if (c.state !== READY && c.distanceTo(cam) < 3000) this.pendingNear++;
      }
    } else if (node.children) {
      for (const c of node.children) this.disposeNode(c);
      node.children = null;
    }
    if (node.mesh) {
      node.mesh.visible = true;
      this.visibleTiles++;
    }
  }

  private disposeNode(node: Node) {
    if (node.children) for (const c of node.children) this.disposeNode(c);
    node.children = null;
    node.abort?.abort();
    if (node.mesh) {
      this.remove(node.mesh);
      node.mesh.geometry.dispose();
      const mat = node.mesh.material as THREE.MeshLambertMaterial;
      if (mat.map && mat.map !== this.fallbackTex) mat.map.dispose();
      mat.dispose();
      node.mesh = null;
    }
    node.state = EMPTY;
  }

  private async load(node: Node) {
    node.state = LOADING;
    this.active++;
    const abort = new AbortController();
    node.abort = abort;
    try {
      const dz = Math.min(node.z, DEM_MAX_Z);
      const shift = node.z - dz;
      const demJob = loadDem(dz, node.x >> shift, node.y >> shift);
      const texJob = this.loadTexture(node, abort.signal);
      await demJob;
      const tex = await texJob;
      if (abort.signal.aborted) {
        tex?.dispose();
        return;
      }
      this.buildMesh(node, dz, tex);
      node.state = READY;
    } catch {
      if (!abort.signal.aborted) node.state = FAILED;
    } finally {
      this.active--;
      if (node.abort === abort) node.abort = null;
    }
  }

  private async loadTexture(node: Node, signal: AbortSignal): Promise<THREE.Texture | null> {
    const src = this.opts.sources;
    const iz = Math.min(node.z + 1, 19);
    let bmp: ImageBitmap | null = null;
    try {
      const tiles = await Promise.all(
        [0, 1, 2, 3].map((q) => loadImageryTile(src, iz, node.x * 2 + (q & 1), node.y * 2 + (q >> 1), signal)),
      );
      const canvas = new OffscreenCanvas(512, 512);
      const ctx = canvas.getContext('2d')!;
      tiles.forEach((t, q) => {
        ctx.drawImage(t, (q & 1) * 256, (q >> 1) * 256, 256, 256);
        t.close();
      });
      bmp = await createImageBitmap(canvas, { imageOrientation: 'flipY' });
    } catch {
      if (signal.aborted) return null;
      try {
        const t = await loadImageryTile(src, node.z, node.x, node.y, signal);
        bmp = await createImageBitmap(t, { imageOrientation: 'flipY' });
        t.close();
      } catch {
        return null;
      }
    }
    const tex = new THREE.Texture(bmp as unknown as HTMLImageElement);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.opts.anisotropy;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.needsUpdate = true;
    return tex;
  }

  private buildMesh(node: Node, dz: number, tex: THREE.Texture | null) {
    const { frame } = this.opts;
    const [mx0, , mx1, my1] = node.mb;
    const G = SEG + 3; // grid with a one-sample apron for normals
    const heights = new Float32Array(G * G);
    const stepM = (mx1 - mx0) / SEG;
    const flatten = node.z >= FLATTEN_Z;
    const smoothDem = node.z >= 13;
    let minH = Infinity;
    let maxH = -Infinity;
    for (let j = 0; j < G; j++) {
      const my = my1 - (j - 1) * stepM;
      for (let i = 0; i < G; i++) {
        const mx = mx0 + (i - 1) * stepM;
        let h = smoothDem ? heightAtMercSmooth(mx, my, dz) : heightAtMerc(mx, my, dz);
        if (h !== h) h = 0;
        if (flatten) h = this.flatten((mx - frame.mx0) * frame.k, -(my - frame.my0) * frame.k, h, this.opts.roadSink);
        heights[j * G + i] = h;
        if (i > 0 && j > 0 && i < G - 1 && j < G - 1) {
          minH = Math.min(minH, h);
          maxH = Math.max(maxH, h);
        }
      }
    }
    node.minH = minH;
    node.maxH = maxH;

    const cx = (node.minX + node.maxX) / 2;
    const cz = (node.minZ + node.maxZ) / 2;
    const cell = node.size / SEG;
    const pos = new Float32Array((VERTS + SKIRT) * 3);
    const nor = new Float32Array((VERTS + SKIRT) * 3);
    for (let j = 0; j <= SEG; j++) {
      for (let i = 0; i <= SEG; i++) {
        const v = j * (SEG + 1) + i;
        const g = (j + 1) * G + (i + 1);
        pos[v * 3] = node.minX + i * cell - cx;
        pos[v * 3 + 1] = heights[g] - minH;
        pos[v * 3 + 2] = node.minZ + j * cell - cz;
        const dx = heights[g + 1] - heights[g - 1];
        const dzz = heights[g + G] - heights[g - G];
        const nx = -dx;
        const ny = 2 * cell;
        const nz = -dzz;
        const l = Math.hypot(nx, ny, nz);
        nor[v * 3] = nx / l;
        nor[v * 3 + 1] = ny / l;
        nor[v * 3 + 2] = nz / l;
      }
    }
    const skirtDepth = Math.max(4, node.size * 0.02);
    for (let k = 0; k < SKIRT; k++) {
      const s = VERTS + k;
      const b = LOOP[k];
      pos[s * 3] = pos[b * 3];
      pos[s * 3 + 1] = pos[b * 3 + 1] - skirtDepth;
      pos[s * 3 + 2] = pos[b * 3 + 2];
      nor[s * 3] = nor[b * 3];
      nor[s * 3 + 1] = nor[b * 3 + 1];
      nor[s * 3 + 2] = nor[b * 3 + 2];
    }

    const { index, uv } = getShared();
    const geo = new THREE.BufferGeometry();
    geo.setIndex(index);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', uv);
    geo.computeBoundingSphere();
    geo.computeBoundingBox();

    const mat = terrainMaterial(tex ?? this.fallbackTex);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx, minH, cz);
    mesh.receiveShadow = node.z >= 15;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.visible = false;
    node.mesh = mesh;
    this.add(mesh);
  }

  /** Rendered ground height incl. the road cut, matching the near-camera mesh. */
  groundHeight(x: number, z: number): number {
    const { frame } = this.opts;
    const h = heightAtMercSmooth(x / frame.k + frame.mx0, -z / frame.k + frame.my0, DEM_MAX_Z);
    if (h !== h) return NaN;
    return this.flatten(x, z, h);
  }

  /** Blend raw terrain towards the road: embankments below, cuts above; untouched over tunnels. */
  private flatten(x: number, z: number, h: number, sink = 0.45): number {
    const { routeIndex, roadHalfWidth, route } = this.opts;
    // under a bridge the ground is the lower road's floor, out to the bridge's ends; the model hides it
    for (const b of this.underpasses) {
      const dx = x - b.x, dz = z - b.z;
      if (Math.abs(dx * b.fx + dz * b.fz) < UNDERPASS_HALF && Math.abs(dx * b.fz - dz * b.fx) < UNDERPASS_SIDE) return b.floor;
    }
    const near = routeIndex.nearest(x, z, roadHalfWidth + 17);
    if (near.index < 0) return h;
    const s = near.f * route.step;
    if (!near.turn) for (const [a, b] of route.tunnels) if (s > a + 4 && s < b - 4) return h;
    const road = near.ele - 0.45;
    const cut = h > road + 0.5;
    const under = near.ele - sink;
    if (cut && this.opts.cutWidth < 8) {
      // a real road cut: a near-vertical rock face of a few metres right at the verge, then a
      // ~50° bank up to the natural slope (the min() carves it into the hillside)
      const dd = Math.max(0, near.dist - roadHalfWidth - 0.8);
      const faceH = 4.5 + 2.5 * Math.sin(s * 0.013) * Math.sin(s * 0.0071 + 1.3);
      const faceW = faceH * 0.22;
      const profile = dd < faceW ? road + (faceH * dd) / faceW : road + faceH + (dd - faceW) * 1.15;
      const carved = Math.min(h, Math.max(road, profile));
      // only a narrow band is reshaped; beyond ~10 m the real hillside (cliffs included) takes over
      return carved + (h - carved) * smooth01((dd - 7) / 6);
    }
    if (near.dist > roadHalfWidth + 17) return h;
    // under the asphalt the ground sits 0.45 m low (no z-fighting); beside it the verge comes
    // back up to just below road level, so there is no ditch along the edge
    const verge = under + (sink - 0.06) * smooth01((near.dist - roadHalfWidth + 0.2) / 1.0);
    // fills ease out into the slope over 14 m
    const width = cut ? Math.max(this.opts.cutWidth, (h - road) * 0.6) : 14;
    const w = 1 - smooth01((near.dist - roadHalfWidth - (cut ? 0.6 : 2.5)) / width);
    return h + (verge - h) * w;
  }

  /** Terrain height (no road flattening) at a world position, NaN when not loaded. */
  heightAt(x: number, z: number): number {
    const { frame } = this.opts;
    return heightAtMerc(x / frame.k + frame.mx0, -z / frame.k + frame.my0, DEM_MAX_Z);
  }

  dispose() {
    for (const r of this.roots) this.disposeNode(r);
    this.fallbackTex.dispose();
  }
}

function smooth01(t: number) {
  const x = Math.min(Math.max(t, 0), 1);
  return x * x * (3 - 2 * x);
}
