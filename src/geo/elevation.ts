// Elevation from AWS Terrain Tiles (Terrarium encoding, free, global, CORS-enabled).
// Austria is backed by the 10 m national DTM, elsewhere mostly SRTM/3DEP.

import { MERC_MAX, mercToTile, tileBoundsMerc } from './mercator.ts';

export const DEM_MAX_Z = 15;
export const DEM_SIZE = 256;

export interface Dem {
  z: number;
  x: number;
  y: number;
  data: Float32Array; // DEM_SIZE², row-major, north row first
}

const demUrl = (z: number, x: number, y: number) =>
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

// Locally baked tiles from national high-resolution DEMs (scripts/bake-dem.py) win over AWS. A route can also
// have tiles finer than DEM_MAX_Z (Gaisberg: 1 m lidar at zoom 16 along the road, 17 close to it); they sit in the
// same index, and every lookup below prefers the finest tile that is loaded.
let localTiles: Promise<Set<string>> | null = null;
/** Finest local zoom near the current route (DEM_MAX_Z for routes that have none; set by localDetailZoom). */
let topZ = DEM_MAX_Z;
function localIndex(): Promise<Set<string>> {
  if (!localTiles) {
    localTiles = fetch('/dem/index.json')
      .then((r) => (r.ok ? r.json() : { tiles: [] }))
      .then((j: { tiles: string[] }) => new Set(j.tiles))
      .catch(() => new Set<string>());
  }
  return localTiles;
}

/** Zoom whose tile a quadtree node at (z, x, y) takes its heights from: the finest local one, else DEM_MAX_Z at most. */
export async function demZoomFor(z: number, x: number, y: number): Promise<number> {
  const idx = await localIndex();
  for (let zz = Math.min(z, topZ); zz > DEM_MAX_Z; zz--) {
    const s = z - zz;
    if (idx.has(`${zz}/${x >> s}/${y >> s}`)) return zz;
  }
  return Math.min(z, DEM_MAX_Z);
}

/** Load the tile at zoom z and every coarser one down to DEM_MAX_Z that a height lookup can fall back to. */
export async function loadDemChain(z: number, x: number, y: number): Promise<Dem> {
  for (let zz = DEM_MAX_Z; zz < z; zz++) {
    const s = z - zz;
    await loadDem(zz, x >> s, y >> s).catch(() => undefined);
  }
  return loadDem(z, x, y);
}

/** Highest zoom of the loaded tiles (DEM_MAX_Z unless the route has finer local tiles). */
export const demTopZoom = () => topZ;

/** True where a finer-than-DEM_MAX_Z tile is loaded with real data (not a "no data" hole). */
export function hasDetailAt(mx: number, my: number): boolean {
  if (topZ <= DEM_MAX_Z) return false;
  const z = DEM_MAX_Z + 1;
  const n = 2 ** z * DEM_SIZE;
  const gx = Math.floor(((mx + MERC_MAX) / (2 * MERC_MAX)) * n);
  const gy = Math.floor(((MERC_MAX - my) / (2 * MERC_MAX)) * n);
  return demPixel(z, gx, gy) === demPixel(z, gx, gy);
}

const pending = new Map<number, Promise<Dem>>();
const loaded = new Map<number, Dem>();
const MAX_CACHED = 800;

const key = (z: number, x: number, y: number) => (z * 1048576 + x) * 1048576 + y;

/**
 * Called once per route with its mercator points: remembers the finest local zoom with tiles near them (the
 * index also lists other routes' tiles, which must not slow this one down) and returns the finest zoom above
 * DEM_MAX_Z whose tiles cover every point, 0 if there is none.
 */
export async function localDetailZoom(points: [number, number][]): Promise<number> {
  const idx = await localIndex();
  topZ = DEM_MAX_Z;
  if (!points.length) return 0;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of points) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const pad = 3000;
  for (const t of idx) {
    const [z, tx, ty] = t.split('/').map(Number);
    if (z <= DEM_MAX_Z || z <= topZ) continue;
    const [a, b, c, d] = tileBoundsMerc(z, tx, ty);
    if (c >= x0 - pad && a <= x1 + pad && d >= y0 - pad && b <= y1 + pad) topZ = z;
  }
  for (let z = topZ; z > DEM_MAX_Z; z--) if (await localDemCovers(points, z)) return z;
  return 0;
}

/** True when locally baked tiles at zoom z cover all the given mercator points. */
export async function localDemCovers(points: Iterable<[number, number]>, z: number): Promise<boolean> {
  const idx = await localIndex();
  if (!idx.size) return false;
  for (const [mx, my] of points) {
    const [tx, ty] = mercToTile(mx, my, z);
    if (!idx.has(`${z}/${Math.floor(tx)}/${Math.floor(ty)}`)) return false;
  }
  return true;
}

async function fetchDem(z: number, x: number, y: number): Promise<Dem> {
  const local = (await localIndex()).has(`${z}/${x}/${y}`);
  const res = await fetch(local ? `/dem/${z}/${x}/${y}.png` : demUrl(z, x, y));
  if (!res.ok) throw new Error(`DEM ${z}/${x}/${y}: ${res.status}`);
  const bmp = await createImageBitmap(await res.blob(), {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  });
  const canvas = new OffscreenCanvas(DEM_SIZE, DEM_SIZE);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const px = ctx.getImageData(0, 0, DEM_SIZE, DEM_SIZE).data;
  const data = new Float32Array(DEM_SIZE * DEM_SIZE);
  for (let i = 0; i < data.length; i++) {
    data[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
  }
  // a fine tile that reaches past its lidar says so with 0 0 0 (-32768 m): no data, the coarser tile answers there
  if (local && z > DEM_MAX_Z) for (let i = 0; i < data.length; i++) if (data[i] < -32767) data[i] = NaN;
  sanitize(data, z, y);
  return { z, x, y, data };
}

/**
 * Terrain tiles carry junk over water: the Hudson beside Central Park has pixels at -31,000 m and
 * +6,600 m, which drew as needles into the sky. Heights no place on Earth has, and pixels that stand
 * further from their neighbours than any cliff could, are filled in from the ground around them
 * (sea level where a whole patch is junk). NaN marks "no data" in a fine local tile and is left alone.
 * The cliff limit is never below 150 m, so retaining walls and rock steps in 1 m lidar stay (they are a few
 * metres high); it only scales up with the pixel at coarse zooms.
 */
function sanitize(data: Float32Array, z: number, y: number) {
  const N = DEM_SIZE;
  const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / 2 ** z)));
  const pixel = (40075016.7 * Math.cos(lat)) / 2 ** z / N;
  const limit = Math.max(150, 4 * pixel);
  let bad: Uint8Array | null = null;
  const mark = (i: number) => {
    if (!bad) bad = new Uint8Array(N * N);
    bad[i] = 1;
  };
  for (let i = 0; i < data.length; i++) if (data[i] < -450 || data[i] > 8900) mark(i);
  const near: number[] = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const i = r * N + c;
      if (bad?.[i] || data[i] !== data[i]) continue;
      near.length = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr, cc = c + dc;
          if ((dr || dc) && rr >= 0 && cc >= 0 && rr < N && cc < N && !bad?.[rr * N + cc] && data[rr * N + cc] === data[rr * N + cc]) near.push(data[rr * N + cc]);
        }
      }
      if (near.length < 3) continue;
      near.sort((p, q) => p - q);
      if (Math.abs(data[i] - near[near.length >> 1]) > limit) mark(i);
    }
  }
  if (!bad) return;
  const flags: Uint8Array = bad;
  // grow good ground into the holes, a ring of pixels per pass
  for (let pass = 0; pass < 24; pass++) {
    const fill: [number, number][] = [];
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const i = r * N + c;
        if (!flags[i]) continue;
        let sum = 0, n = 0;
        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const rr = r + dr, cc = c + dc;
          if (rr >= 0 && cc >= 0 && rr < N && cc < N && !flags[rr * N + cc]) { sum += data[rr * N + cc]; n++; }
        }
        if (n) fill.push([i, sum / n]);
      }
    }
    if (!fill.length) break;
    for (const [i, v] of fill) { data[i] = v; flags[i] = 0; }
  }
  for (let i = 0; i < data.length; i++) if (flags[i]) data[i] = 0;
}

export function loadDem(z: number, x: number, y: number): Promise<Dem> {
  const k = key(z, x, y);
  let p = pending.get(k);
  if (!p) {
    p = fetchDem(z, x, y).then(
      (dem) => {
        loaded.set(k, dem);
        if (loaded.size > MAX_CACHED) {
          const oldest = loaded.keys().next().value!;
          loaded.delete(oldest);
          pending.delete(oldest);
        }
        return dem;
      },
      (err) => {
        pending.delete(k);
        throw err;
      },
    );
    pending.set(k, p);
  }
  return p;
}

export function peekDem(z: number, x: number, y: number): Dem | undefined {
  return loaded.get(key(z, x, y));
}

let lastDem: Dem | undefined;

/** Raw DEM value at global pixel (gx, gy) of zoom z, NaN if that tile isn't loaded. */
export function demPixel(z: number, gx: number, gy: number): number {
  const tx = Math.floor(gx / DEM_SIZE);
  const ty = Math.floor(gy / DEM_SIZE);
  let dem = lastDem;
  if (!dem || dem.z !== z || dem.x !== tx || dem.y !== ty) {
    dem = loaded.get(key(z, tx, ty));
    if (!dem) return NaN;
    lastDem = dem;
  }
  return dem.data[(gy - ty * DEM_SIZE) * DEM_SIZE + (gx - tx * DEM_SIZE)];
}

/** Seamless bilinear height across tile borders; falls back to coarser zooms. */
export function heightAtMerc(mx: number, my: number, z: number): number {
  for (let zz = z; zz >= 0; zz--) {
    const n = 2 ** zz * DEM_SIZE;
    const gx = ((mx + MERC_MAX) / (2 * MERC_MAX)) * n - 0.5;
    const gy = ((MERC_MAX - my) / (2 * MERC_MAX)) * n - 0.5;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const tx = gx - x0;
    const ty = gy - y0;
    let a = demPixel(zz, x0, y0);
    let b = demPixel(zz, x0 + 1, y0);
    let c = demPixel(zz, x0, y0 + 1);
    let d = demPixel(zz, x0 + 1, y0 + 1);
    if (a !== a && b !== b && c !== c && d !== d) continue;
    // a hole or unloaded tile beside real fine data: take the coarser zoom's smooth answer instead of its edge value
    if (zz > DEM_MAX_Z && (a !== a || b !== b || c !== c || d !== d)) continue;
    const any = a === a ? a : b === b ? b : c === c ? c : d;
    if (a !== a) a = any;
    if (b !== b) b = any;
    if (c !== c) c = any;
    if (d !== d) d = any;
    const top = a + (b - a) * tx;
    const bot = c + (d - c) * tx;
    return top + (bot - top) * ty;
  }
  return NaN;
}

/** Bilinear sample at fractional pixel coords (pixel centres at i + 0.5). */
export function sampleDem(dem: Dem, px: number, py: number): number {
  const fx = Math.min(Math.max(px - 0.5, 0), DEM_SIZE - 1.001);
  const fy = Math.min(Math.max(py - 0.5, 0), DEM_SIZE - 1.001);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const d = dem.data;
  const i = y0 * DEM_SIZE + x0;
  const a = d[i] + (d[i + 1] - d[i]) * tx;
  const b = d[i + DEM_SIZE] + (d[i + DEM_SIZE + 1] - d[i + DEM_SIZE]) * tx;
  return a + (b - a) * ty;
}

/**
 * Synchronous elevation lookup at a mercator point using whatever tile is loaded
 * at zoom z (falls back to coarser loaded tiles). Returns NaN when nothing is loaded.
 */
export function elevationAtMercSync(mx: number, my: number, z: number): number {
  for (let zz = z; zz >= 0; zz--) {
    const [tx, ty] = mercToTile(mx, my, zz);
    const ix = Math.floor(tx);
    const iy = Math.floor(ty);
    const dem = loaded.get(key(zz, ix, iy));
    if (dem) return sampleDem(dem, (tx - ix) * DEM_SIZE, (ty - iy) * DEM_SIZE);
  }
  return NaN;
}

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
}

/**
 * C1-continuous (Catmull-Rom) height: removes the faceted look bilinear DEM
 * interpolation gives steep slopes under low sun. Falls back to bilinear at gaps.
 */
export function heightAtMercSmooth(mx: number, my: number, z: number): number {
  // finer local tiles first; where one is missing or has a hole the next coarser answers, as smoothly
  for (let zz = z; zz > DEM_MAX_Z; zz--) {
    const h = catmullAt(mx, my, zz);
    if (h === h) return h;
  }
  const zc = Math.min(z, DEM_MAX_Z);
  const h = catmullAt(mx, my, zc);
  return h === h ? h : heightAtMerc(mx, my, zc);
}

function catmullAt(mx: number, my: number, z: number): number {
  const n = 2 ** z * DEM_SIZE;
  const gx = ((mx + MERC_MAX) / (2 * MERC_MAX)) * n - 0.5;
  const gy = ((MERC_MAX - my) / (2 * MERC_MAX)) * n - 0.5;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const tx = gx - x0;
  const ty = gy - y0;
  const rows = [0, 0, 0, 0];
  for (let j = -1; j <= 2; j++) {
    const a = demPixel(z, x0 - 1, y0 + j);
    const b = demPixel(z, x0, y0 + j);
    const c = demPixel(z, x0 + 1, y0 + j);
    const d = demPixel(z, x0 + 2, y0 + j);
    if (a !== a || b !== b || c !== c || d !== d) return NaN;
    rows[j + 1] = catmull(a, b, c, d, tx);
  }
  return catmull(rows[0], rows[1], rows[2], rows[3], ty);
}

/** Height from the finest tile loaded at this point (bilinear), for lookups that have no use for the smoothing. */
export const heightBest = (mx: number, my: number) => heightAtMerc(mx, my, topZ);

/** Smooth height from the finest tile loaded at this point. */
export const heightBestSmooth = (mx: number, my: number) => heightAtMercSmooth(mx, my, topZ);

/** Ensure all DEM tiles at zoom z covering the given mercator points are loaded. */
export async function preloadDemForPoints(points: Iterable<[number, number]>, z: number): Promise<void> {
  const need = new Map<number, [number, number]>();
  for (const [mx, my] of points) {
    const [tx, ty] = mercToTile(mx, my, z);
    const ix = Math.floor(tx);
    const iy = Math.floor(ty);
    need.set(key(z, ix, iy), [ix, iy]);
  }
  await Promise.all(
    [...need.values()].map(([x, y]) => loadDem(z, x, y).catch(() => undefined)),
  );
}

/** Load every DEM tile at zoom z intersecting a mercator bbox. */
export async function preloadDemForBox(minX: number, minY: number, maxX: number, maxY: number, z: number) {
  const [x0, y0] = mercToTile(minX, maxY, z);
  const [x1, y1] = mercToTile(maxX, minY, z);
  const jobs: Promise<unknown>[] = [];
  for (let y = Math.floor(y0); y <= Math.floor(y1); y++) {
    for (let x = Math.floor(x0); x <= Math.floor(x1); x++) {
      jobs.push(loadDem(z, x, y).catch(() => undefined));
    }
  }
  await Promise.all(jobs);
}

/**
 * Load the tiles a height lookup in this box can use: every DEM_MAX_Z tile, and the finer local tiles of the
 * route that lie in it. Routes without fine tiles load exactly what preloadDemForBox(…, DEM_MAX_Z) did.
 */
export async function preloadDemBest(minX: number, minY: number, maxX: number, maxY: number) {
  await Promise.all([preloadDemForBox(minX, minY, maxX, maxY, DEM_MAX_Z), preloadDemLocal(minX, minY, maxX, maxY)]);
}

/** Load only the finer-than-DEM_MAX_Z local tiles that lie in the box. */
export async function preloadDemLocal(minX: number, minY: number, maxX: number, maxY: number) {
  const idx = await localIndex();
  const jobs: Promise<unknown>[] = [];
  for (let z = DEM_MAX_Z + 1; z <= topZ; z++) {
    const [x0, y0] = mercToTile(minX, maxY, z);
    const [x1, y1] = mercToTile(maxX, minY, z);
    for (let y = Math.floor(y0); y <= Math.floor(y1); y++) {
      for (let x = Math.floor(x0); x <= Math.floor(x1); x++) {
        if (idx.has(`${z}/${x}/${y}`)) jobs.push(loadDem(z, x, y).catch(() => undefined));
      }
    }
  }
  await Promise.all(jobs);
}
