// OpenStreetMap features along the route corridor via Overpass:
// forests (→ instanced trees), buildings (→ extruded houses), roads + water (→ tree exclusion).

import { get, set } from 'idb-keyval';
import { lonLatToWorld } from './mercator.ts';
import type { Route } from './route.ts';

export interface Polygon {
  outer: Float32Array; // x,z pairs (closed ring, last != first)
  holes: Float32Array[];
  bbox: [number, number, number, number];
  leaf?: 'needle' | 'broad' | 'mixed';
}

export type RoofShape = 'flat' | 'gabled' | 'hipped' | 'half-hipped' | 'skillion' | 'pyramidal';

export interface Building {
  ring: Float32Array;
  height: number;
  roof: RoofShape;
  kind: string;
  /** OSM building:levels when tagged. */
  levels?: number;
  /** Explicit colours (OSM building:colour / roof:colour) when tagged. */
  wallColour?: string;
  roofColour?: string;
  name?: string;
  /** roof:shape was tagged (not inferred). */
  explicitRoof?: boolean;
  /** A 3D part of a building (OSM building:part): it has its own height and may start above the ground. */
  part?: boolean;
  /** Height above the ground where a part starts (OSM min_height): towers on a podium, setbacks. */
  minHeight?: number;
  /** OSM roof:height of a pyramidal roof (m). */
  roofHeight?: number;
  /** OSM building:material (brick, glass, concrete …) when tagged. */
  material?: string;
  /** Raw OSM roof:shape (dome, onion, mansard, round …) and roof:material, kept for city styles that draw them (Vienna). */
  roofTag?: string;
  roofMaterial?: string;
  /** height was tagged (not inferred from levels or the building type). */
  heightTagged?: boolean;
  /** Timber upper storey forced on or off by a route scene (osmTags "serpentine:wood_top"); random otherwise. */
  woodTop?: boolean;
}

/** Open land cover that changes ground shading and ground cover. */
export type CoverClass = 'meadow' | 'built' | 'scrub' | 'rock';

export interface Cover {
  poly: Polygon;
  cls: CoverClass;
}

/** Linear features beside roads: guard rails, fences, walls, hedges, power lines. */
export interface Barrier {
  pts: Float32Array;
  kind: string;
  /** Tagged height (m) when there is one; New York maps feet and inches (3'10"). */
  height?: number;
}

/** Communication towers, masts and bell towers (OSM man_made tower/mast): landmarks seen from far. */
export interface Tower {
  x: number;
  z: number;
  /** Footprint radius (m); 0 for a mapped point. */
  r: number;
  /** Tagged height (m), 0 when unknown. */
  height: number;
  /** A concrete transmitter (Mont Ventoux, Kitzbüheler Horn) rather than a slim mast. */
  concrete: boolean;
  /** A church's bell tower (mapped apart from the church): white shaft and spire. */
  bell: boolean;
  name?: string;
}

/** Point features: benches, bus stops, crosses, signposts, peaks, paragliding take-offs… */
export interface Poi {
  x: number;
  z: number;
  kind: string;
  name?: string;
}

export interface Line {
  pts: Float32Array;
  width: number;
  kind: string;
}

export interface OsmWorld {
  forests: Polygon[];
  water: Polygon[];
  buildings: Building[];
  roads: Line[];
  trees: Float32Array;
  cover: Cover[];
  barriers: Barrier[];
  pois: Poi[];
  towers: Tower[];
  /** leisure=park/garden outlines: city styles keep lawn inside them and pavement outside (Vienna). */
  parks: Polygon[];
  /** railway=tram centre lines (x,z pairs), one per mapped track (Vienna Ring). */
  trams: Float32Array[];
}

type LatLon = { lat: number; lon: number };
export interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  geometry?: LatLon[];
  members?: { type: string; role: string; geometry?: LatLon[] }[];
}

const ENDPOINTS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const KEEP_TAGS = [
  'landuse', 'natural', 'building', 'building:levels', 'height', 'roof:shape', 'roof:colour', 'building:colour', 'highway',
  'building:part', 'min_height', 'roof:height', 'building:material', 'roof:material',
  'railway', 'leaf_type', 'man_made', 'barrier', 'power', 'amenity', 'tourism', 'historic', 'information', 'name', 'sport', 'leisure',
];

const COVER: Record<string, CoverClass> = {
  meadow: 'meadow', grass: 'meadow', farmland: 'meadow', village_green: 'meadow', orchard: 'meadow', grassland: 'meadow',
  heath: 'meadow', residential: 'built', farmyard: 'built', industrial: 'built', commercial: 'built', retail: 'built',
  scrub: 'scrub', bare_rock: 'rock', scree: 'rock', cliff: 'rock',
};

const FLAT_KINDS = new Set(['industrial', 'commercial', 'retail', 'warehouse', 'supermarket', 'garages', 'hangar', 'service', 'parking', 'container']);

const ROAD_WIDTH: Record<string, number> = {
  motorway: 14, trunk: 11, primary: 9, secondary: 8, tertiary: 7, unclassified: 5.5, residential: 5.5,
  living_street: 5, service: 4, track: 3.5, cycleway: 2.5, path: 1.5, footway: 1.5, bridleway: 2, steps: 2,
};

function corridorBoxes(route: Route, corridor: number): string[] {
  const boxes: string[] = [];
  const chunk = Math.max(1, Math.round(1500 / route.step));
  for (let a = 0; a < route.n - 1; a += chunk) {
    const b = Math.min(route.n - 1, a + chunk);
    let s = 90, w = 180, n = -90, e = -180;
    for (let i = a; i <= b; i++) {
      s = Math.min(s, route.lat[i]);
      n = Math.max(n, route.lat[i]);
      w = Math.min(w, route.lon[i]);
      e = Math.max(e, route.lon[i]);
    }
    const dLat = corridor / 111320;
    const dLon = corridor / (111320 * Math.cos((route.lat[a] * Math.PI) / 180));
    boxes.push(`${(s - dLat).toFixed(5)},${(w - dLon).toFixed(5)},${(n + dLat).toFixed(5)},${(e + dLon).toFixed(5)}`);
  }
  return boxes;
}

function buildQuery(boxes: string[]): string {
  const parts = boxes.map(
    (b) =>
      `way["landuse"="forest"](${b});relation["landuse"="forest"](${b});` +
      `way["natural"="wood"](${b});relation["natural"="wood"](${b});` +
      `way["natural"="water"](${b});relation["natural"="water"](${b});` +
      `way["building"](${b});way["highway"](${b});node["natural"="tree"](${b});`,
  );
  return `[out:json][timeout:120][maxsize:536870912];(${parts.join('')});out geom qt;`;
}

async function overpass(query: string): Promise<OsmElement[]> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const url of ENDPOINTS) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25_000);
      try {
        const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: query }), signal: ctrl.signal });
        if (!res.ok) throw new Error(`Overpass ${res.status}`);
        const json = await res.json();
        return json.elements as OsmElement[];
      } catch (e) {
        lastErr = e;
      } finally {
        clearTimeout(timer);
      }
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw lastErr;
}

/** Strip to the tags we use and round coordinates — keeps caches and baked files small. */
export function compactElements(elements: OsmElement[]): OsmElement[] {
  const r = (v: number) => Math.round(v * 1e6) / 1e6;
  const pts = (g?: LatLon[]) => g?.map((p) => ({ lat: r(p.lat), lon: r(p.lon) }));
  return elements.map((el) => {
    const tags: Record<string, string> = {};
    for (const k of KEEP_TAGS) if (el.tags?.[k] !== undefined) tags[k] = el.tags[k];
    const out: OsmElement = { type: el.type, id: el.id, tags };
    if (el.lat !== undefined) out.lat = r(el.lat);
    if (el.lon !== undefined) out.lon = r(el.lon);
    if (el.geometry) out.geometry = pts(el.geometry);
    if (el.members) out.members = el.members.filter((m) => m.geometry).map((m) => ({ type: m.type, role: m.role, geometry: pts(m.geometry) }));
    return out;
  });
}

export async function loadOsmElements(
  route: Route,
  corridor: number,
  onProgress?: (done: number, total: number) => void,
): Promise<OsmElement[]> {
  // presets ship with baked OSM data
  try {
    const res = await fetch(`/osm/${route.id}.json`);
    if (res.ok && res.headers.get('content-type')?.includes('json')) return (await res.json()) as OsmElement[];
  } catch {
    /* not baked */
  }
  const cacheKey = `osm:v2:${route.id}:${route.n}:${corridor}`;
  try {
    const cached = await get<OsmElement[]>(cacheKey);
    if (cached) return cached;
  } catch {
    /* IndexedDB unavailable */
  }
  const boxes = corridorBoxes(route, corridor);
  const groups: string[][] = [];
  for (let i = 0; i < boxes.length; i += 3) groups.push(boxes.slice(i, i + 3));
  const seen = new Map<string, OsmElement>();
  let failed = 0;
  for (let i = 0; i < groups.length; i++) {
    onProgress?.(i, groups.length);
    try {
      for (const el of await overpass(buildQuery(groups[i]))) seen.set(`${el.type}${el.id}`, el);
    } catch {
      failed++;
    }
  }
  if (failed === groups.length) throw new Error('Overpass unavailable');
  const elements = compactElements([...seen.values()]);
  if (!failed) {
    try {
      await set(cacheKey, elements);
    } catch {
      /* quota or private mode */
    }
  }
  return elements;
}

function joinRings(ways: LatLon[][]): LatLon[][] {
  const rings: LatLon[][] = [];
  const pool = ways.filter((w) => w.length > 1).map((w) => w.slice());
  const same = (a: LatLon, b: LatLon) => a.lat === b.lat && a.lon === b.lon;
  while (pool.length) {
    let ring = pool.pop()!;
    let guard = 0;
    while (!same(ring[0], ring[ring.length - 1]) && guard++ < 10000) {
      const end = ring[ring.length - 1];
      const idx = pool.findIndex((w) => same(w[0], end) || same(w[w.length - 1], end));
      if (idx < 0) break;
      let next = pool.splice(idx, 1)[0];
      if (!same(next[0], end)) next = next.reverse();
      ring = ring.concat(next.slice(1));
    }
    if (ring.length >= 4) rings.push(ring);
  }
  return rings;
}

function toRing(route: Route, pts: LatLon[]): Float32Array {
  const closed = pts.length > 1 && pts[0].lat === pts[pts.length - 1].lat && pts[0].lon === pts[pts.length - 1].lon;
  const count = closed ? pts.length - 1 : pts.length;
  const out = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const [x, z] = lonLatToWorld(route.frame, pts[i].lon, pts[i].lat);
    out[i * 2] = x;
    out[i * 2 + 1] = z;
  }
  return out;
}

/** Footprint area of a ring of x,z pairs (m²). */
function ringArea(r: Float32Array): number {
  let a = 0;
  for (let i = 0, n = r.length / 2; i < n; i++) {
    const j = (i + 1) % n;
    a += r[i * 2] * r[j * 2 + 1] - r[j * 2] * r[i * 2 + 1];
  }
  return Math.abs(a) / 2;
}

function ringBbox(r: Float32Array): [number, number, number, number] {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (let i = 0; i < r.length; i += 2) {
    a = Math.min(a, r[i]);
    c = Math.max(c, r[i]);
    b = Math.min(b, r[i + 1]);
    d = Math.max(d, r[i + 1]);
  }
  return [a, b, c, d];
}

function leafType(tags?: Record<string, string>): Polygon['leaf'] {
  const t = tags?.leaf_type;
  if (t === 'needleleaved') return 'needle';
  if (t === 'broadleaved') return 'broad';
  if (t === 'mixed') return 'mixed';
  return undefined;
}

function polygonsFrom(route: Route, el: OsmElement): Polygon[] {
  if (el.type === 'way' && el.geometry) {
    const outer = toRing(route, el.geometry);
    if (outer.length < 6) return [];
    return [{ outer, holes: [], bbox: ringBbox(outer), leaf: leafType(el.tags) }];
  }
  if (el.type === 'relation' && el.members) {
    const outers = joinRings(el.members.filter((m) => m.role !== 'inner' && m.geometry).map((m) => m.geometry!));
    const inners = joinRings(el.members.filter((m) => m.role === 'inner' && m.geometry).map((m) => m.geometry!)).map(
      (r) => toRing(route, r),
    );
    return outers.map((o) => {
      const outer = toRing(route, o);
      const bbox = ringBbox(outer);
      const holes = inners.filter((h) => {
        const hb = ringBbox(h);
        return hb[0] >= bbox[0] && hb[2] <= bbox[2] && hb[1] >= bbox[1] && hb[3] <= bbox[3];
      });
      return { outer, holes, bbox, leaf: leafType(el.tags) };
    });
  }
  return [];
}

function inRing(r: Float32Array, x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, n = r.length / 2, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2], zi = r[i * 2 + 1], xj = r[j * 2], zj = r[j * 2 + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** A building mapped in 3D parts is drawn from its parts: its plain outline would fill the setbacks in again. */
function dropOutlines(buildings: Building[]): Building[] {
  const parts = buildings.filter((b) => b.part);
  if (!parts.length) return buildings;
  const CELL = 60;
  const grid = new Map<string, number[]>();
  for (const p of parts) {
    const [a, b, c, d] = ringBbox(p.ring);
    const x = (a + c) / 2, z = (b + d) / 2;
    const k = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
    let l = grid.get(k);
    if (!l) grid.set(k, (l = []));
    l.push(x, z);
  }
  return buildings.filter((bld) => {
    if (bld.part) return true;
    const [a, b, c, d] = ringBbox(bld.ring);
    for (let gx = Math.floor(a / CELL); gx <= Math.floor(c / CELL); gx++) {
      for (let gz = Math.floor(b / CELL); gz <= Math.floor(d / CELL); gz++) {
        const l = grid.get(`${gx},${gz}`);
        if (!l) continue;
        for (let i = 0; i < l.length; i += 2) if (inRing(bld.ring, l[i], l[i + 1])) return false;
      }
    }
    return true;
  });
}

function buildingHeight(tags: Record<string, string>): number {
  const h = parseFloat(tags.height ?? '');
  // Manhattan's towers reach 472 m (the old 80 m cap cut the skyline off level)
  if (Number.isFinite(h) && h > 1) return Math.min(h, 600);
  const levels = parseFloat(tags['building:levels'] ?? '');
  if (Number.isFinite(levels)) return Math.min(levels * 3 + 1, 600);
  switch (tags.building) {
    case 'garage': case 'garages': case 'shed': case 'carport': case 'hut': case 'cabin': case 'container': return 3.2;
    case 'apartments': case 'hotel': case 'commercial': case 'retail': case 'office': return 13;
    case 'church': case 'chapel': return 14;
    case 'industrial': case 'warehouse': return 9;
    default: return 7;
  }
}

export function parseOsm(route: Route, elements: OsmElement[]): OsmWorld {
  const forests: Polygon[] = [];
  const water: Polygon[] = [];
  const buildings: Building[] = [];
  const roads: Line[] = [];
  const trees: number[] = [];
  const cover: Cover[] = [];
  const barriers: Barrier[] = [];
  const pois: Poi[] = [];
  const towers: Tower[] = [];
  const parks: Polygon[] = [];
  const trams: Float32Array[] = [];
  // church and defence towers are buildings or scene models; these are the antennas
  const antenna = (t: Record<string, string>) =>
    t.man_made === 'mast' || (t.man_made === 'tower' && (t['tower:type'] === 'communication' || t['tower:type'] === 'bell_tower'));
  const towerHeight = (t: Record<string, string>) => {
    const h = parseFloat(t.height ?? '');
    if (Number.isFinite(h) && h > 1) return h;
    const lv = parseFloat(t['building:levels'] ?? '');
    return Number.isFinite(lv) ? lv * 3 + 1 : 0;
  };
  for (const el of elements) {
    const t = el.tags ?? {};
    if (el.type === 'node') {
      if (el.lon === undefined || el.lat === undefined) continue;
      if (antenna(t)) {
        const [x, z] = lonLatToWorld(route.frame, el.lon, el.lat);
        towers.push({ x, z, r: 0, height: towerHeight(t), concrete: t['tower:construction'] === 'concrete', bell: t['tower:type'] === 'bell_tower', name: t.name });
      }
      if (t.natural === 'tree') {
        trees.push(...lonLatToWorld(route.frame, el.lon, el.lat));
        continue;
      }
      const kind = poiKind(t);
      if (kind) {
        const [x, z] = lonLatToWorld(route.frame, el.lon, el.lat);
        pois.push({ x, z, kind, name: t.name });
      }
      continue;
    }
    // towers and masts are landmarks (Props.towers, or a scene model), not houses
    if (t.man_made === 'tower' || t.man_made === 'mast') {
      if (antenna(t) && el.type === 'way' && el.geometry) {
        const ring = toRing(route, el.geometry);
        const [a, b, c, d] = ringBbox(ring);
        const r = Math.min(c - a, d - b) / 2;
        const bell = t['tower:type'] === 'bell_tower';
        const concrete = !bell && (t['tower:construction'] === 'concrete' || (r >= 3 && t['tower:construction'] !== 'lattice'));
        towers.push({ x: (a + c) / 2, z: (b + d) / 2, r, height: towerHeight(t), concrete, bell, name: t.name });
      }
      continue;
    }
    if (t.railway === 'tram' && el.type === 'way' && el.geometry) {
      trams.push(toLine(route, el.geometry));
      continue;
    }
    if ((t.leisure === 'park' || t.leisure === 'garden') && (el.type === 'way' || el.type === 'relation')) parks.push(...polygonsFrom(route, el));
    const coverCls = COVER[t.landuse] ?? COVER[t.natural];
    if (t.landuse === 'forest' || t.natural === 'wood') forests.push(...polygonsFrom(route, el));
    else if (t.natural === 'water') water.push(...polygonsFrom(route, el));
    else if (t['building:part'] && t['building:part'] !== 'no') {
      // 3D buildings: each part is its own block from min_height up to height
      const rs = t['roof:shape'];
      const minHeight = parseFloat(t.min_height ?? '');
      const roofHeight = parseFloat(t['roof:height'] ?? '');
      for (const poly of polygonsFrom(route, el)) {
        buildings.push({
          ring: poly.outer, height: buildingHeight(t), roof: rs === 'pyramidal' || rs === 'dome' || rs === 'onion' ? 'pyramidal' : 'flat',
          kind: t['building:part'], part: true, minHeight: Number.isFinite(minHeight) && minHeight > 0 ? minHeight : undefined,
          roofHeight: Number.isFinite(roofHeight) ? roofHeight : undefined, material: t['building:material'],
          wallColour: t['building:colour'], roofColour: t['roof:colour'], name: t.name, explicitRoof: !!rs,
          roofTag: rs, roofMaterial: t['roof:material'], heightTagged: Number.isFinite(parseFloat(t.height ?? '')),
        });
      }
    } else if (t.building && t.building !== 'no' && el.type === 'relation' && el.members) {
      // multipolygon buildings (courtyard blocks, museums): the outer rings
      for (const poly of polygonsFrom(route, el)) {
        buildings.push({
          ring: poly.outer, height: buildingHeight(t), roof: 'flat', kind: t.building, material: t['building:material'],
          wallColour: t['building:colour'], roofColour: t['roof:colour'], name: t.name,
          roofTag: t['roof:shape'], roofMaterial: t['roof:material'], heightTagged: Number.isFinite(parseFloat(t.height ?? '')),
        });
      }
    } else if (t.building && t.building !== 'no' && el.type === 'way' && el.geometry) {
      const ring = toRing(route, el.geometry);
      if (ring.length < 6) continue;
      const roofTag = t['roof:shape'];
      const [a, b, c, d] = ringBbox(ring);
      const area = (c - a) * (d - b);
      const roof: RoofShape =
        roofTag === 'flat' ? 'flat'
          : roofTag === 'hipped' ? 'hipped'
            : roofTag === 'half-hipped' ? 'half-hipped'
              : roofTag === 'skillion' ? 'skillion'
                : roofTag ? 'gabled'
                  // hotels and blocks up to ~50 m have tile roofs too (the footprint, not its bounding box:
                  // the curved Stelvio hotel); sheds and shops stay flat
                  : (area < 900 || ringArea(ring) < 2500) && !FLAT_KINDS.has(t.building) ? 'gabled' : 'flat';
      const levels = parseFloat(t['building:levels'] ?? '');
      // tiny footprints are one storey (a 9 m² substation stood as a 7 m tower); untagged ones out in
      // the meadows are hay barns and sheds, not two-storey houses
      const tiny = !t.height && !Number.isFinite(levels) && ringArea(ring) < 40;
      const shed = tiny && t.building === 'yes' && !t.name;
      buildings.push({
        ring, height: tiny ? 3.2 : buildingHeight(t), roof, kind: shed ? 'shed' : t.building,
        levels: Number.isFinite(levels) ? levels : undefined,
        wallColour: t['building:colour'], roofColour: t['roof:colour'], name: t.name, explicitRoof: !!roofTag,
        material: t['building:material'],
        roofTag: roofTag, roofMaterial: t['roof:material'], heightTagged: Number.isFinite(parseFloat(t.height ?? '')),
        roofHeight: Number.isFinite(parseFloat(t['roof:height'] ?? '')) ? parseFloat(t['roof:height']) : undefined,
        woodTop: t['serpentine:wood_top'] === undefined ? undefined : t['serpentine:wood_top'] === 'yes',
      });
    } else if (t.barrier && el.type === 'way' && el.geometry && !t.area) {
      barriers.push({ pts: toLine(route, el.geometry), kind: t.barrier, height: barrierHeight(t.height) });
    } else if (t.power === 'line' || t.power === 'minor_line') {
      if (el.geometry) barriers.push({ pts: toLine(route, el.geometry), kind: `power:${t.power}` });
    } else if (coverCls && (el.type === 'way' || el.type === 'relation') && t.natural !== 'cliff') {
      for (const poly of polygonsFrom(route, el)) cover.push({ poly, cls: coverCls });
    } else if (t.highway && el.type === 'way' && el.geometry) {
      const pts = new Float32Array(el.geometry.length * 2);
      el.geometry.forEach((p, i) => {
        const [x, z] = lonLatToWorld(route.frame, p.lon, p.lat);
        pts[i * 2] = x;
        pts[i * 2 + 1] = z;
      });
      roads.push({ pts, kind: t.highway, width: ROAD_WIDTH[t.highway] ?? 4 });
    }
  }
  return { forests, water, buildings: dropOutlines(buildings), roads, trees: new Float32Array(trees), cover, barriers, pois, towers, parks, trams };
}

function barrierHeight(v?: string): number | undefined {
  if (!v) return undefined;
  const ft = /^(\d+)'\s*(?:(\d+)")?$/.exec(v.trim());
  const h = ft ? parseInt(ft[1], 10) * 0.3048 + (ft[2] ? parseInt(ft[2], 10) * 0.0254 : 0) : parseFloat(v);
  return Number.isFinite(h) && h > 0 ? h : undefined;
}

function toLine(route: Route, g: LatLon[]): Float32Array {
  const pts = new Float32Array(g.length * 2);
  g.forEach((p, i) => {
    const [x, z] = lonLatToWorld(route.frame, p.lon, p.lat);
    pts[i * 2] = x;
    pts[i * 2 + 1] = z;
  });
  return pts;
}

function poiKind(t: Record<string, string>): string | null {
  if (t.highway === 'bus_stop') return 'bus_stop';
  if (t.highway === 'street_lamp') return 'street_lamp';
  if (t.amenity === 'bench') return 'bench';
  if (t.amenity === 'shelter') return 'shelter';
  if (t.historic === 'wayside_cross' || t.man_made === 'cross' || t.summit_cross === 'yes') return 'cross';
  if (t.historic === 'wayside_shrine') return 'shrine';
  if (t.tourism === 'information' && (t.information === 'guidepost' || !t.information)) return 'guidepost';
  if (t.tourism === 'information' && t.information === 'board') return 'board';
  if (t.tourism === 'viewpoint') return 'viewpoint';
  if (t.natural === 'peak') return 'peak';
  if (t.sport === 'free_flying') return 'takeoff';
  if (t.power === 'pole' || t.power === 'tower') return `power:${t.power}`;
  if (t.man_made === 'mast') return 'mast';
  return null;
}
