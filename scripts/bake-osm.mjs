// Bakes OSM corridor data (forests, buildings, roads, water, land cover, barriers, landmarks)
// for preset routes into public/osm/<id>.json so presets load instantly.
// Run: node scripts/bake-osm.mjs [id] [--from=<overpass dump.json>]  (a local dump skips Overpass)
//      node scripts/bake-osm.mjs <id> --lead-in   adds only the lead-in corridor to the existing file
//      node scripts/bake-osm.mjs <id> --add=<overpass.json>[,<more.json>]   merges already fetched elements into the
//        existing file without asking Overpass (3D building parts and park details for Central Park)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const CORRIDOR = 420;
// per-route override (metres), e.g. if Overpass rejects a dense city corridor as too large: { "central-park": 300 }
const CORRIDOR_OVERRIDE = {};
const ENDPOINTS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const KEEP = [
  'landuse', 'natural', 'building', 'building:levels', 'height', 'roof:shape', 'roof:colour', 'roof:material',
  'building:colour', 'building:material', 'roof:orientation', 'highway', 'leaf_type', 'leaf_cycle', 'man_made',
  'tower:type', 'tower:construction', 'barrier', 'power', 'amenity', 'tourism', 'historic', 'information', 'waterway',
  'surface', 'name', 'sport', 'leisure', 'colour', 'aerialway', 'bridge', 'tunnel', 'width', 'lanes', 'denotation',
  'oneway', 'junction', 'building:part', 'min_height', 'roof:height', 'layer',
];
// land cover and roadside features the renderer uses beyond forests/buildings
const EXTRA = [
  'way["landuse"~"^(meadow|grass|farmland|orchard|residential|village_green|vineyard|allotments)$"]',
  'way["natural"~"^(grassland|scrub|heath|bare_rock|scree|cliff|tree_row|wetland)$"]',
  'way["barrier"~"^(guard_rail|fence|wall|hedge|retaining_wall)$"]', 'way["power"="line"]', 'way["waterway"]',
  'way["man_made"~"^(tower|mast)$"]', 'node["man_made"~"^(tower|mast|cross)$"]', 'node["power"~"^(pole|tower)$"]',
  'node["highway"~"^(bus_stop|street_lamp)$"]', 'node["amenity"~"^(bench|shelter)$"]',
  'node["tourism"~"^(information|viewpoint)$"]', 'node["historic"~"^(wayside_cross|wayside_shrine|memorial)$"]',
  'node["natural"~"^(peak|tree)$"]', 'node["sport"="free_flying"]', 'way["sport"="free_flying"]',
  'node["highway"="turning_circle"]',
];

function boxes(coords, corridor) {
  const out = [];
  let start = 0, acc = 0;
  const hav = (a, b) => {
    const r = Math.PI / 180, dLat = (b[1] - a[1]) * r, dLon = (b[0] - a[0]) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2;
    return 2 * 6371008.8 * Math.asin(Math.sqrt(h));
  };
  const flush = (a, b) => {
    let s = 90, w = 180, n = -90, e = -180;
    for (let i = a; i <= b; i++) { s = Math.min(s, coords[i][1]); n = Math.max(n, coords[i][1]); w = Math.min(w, coords[i][0]); e = Math.max(e, coords[i][0]); }
    const dLat = corridor / 111320, dLon = corridor / (111320 * Math.cos((coords[a][1] * Math.PI) / 180));
    out.push(`${(s - dLat).toFixed(5)},${(w - dLon).toFixed(5)},${(n + dLat).toFixed(5)},${(e + dLon).toFixed(5)}`);
  };
  for (let i = 1; i < coords.length; i++) {
    acc += hav(coords[i - 1], coords[i]);
    if (acc >= 1500) { flush(start, i); start = i; acc = 0; }
  }
  if (start < coords.length - 1) flush(start, coords.length - 1);
  return out;
}

const query = (bs) => `[out:json][timeout:120][maxsize:536870912];(${bs.map((b) =>
  `way["landuse"="forest"](${b});relation["landuse"="forest"](${b});way["natural"="wood"](${b});relation["natural"="wood"](${b});` +
  `way["natural"="water"](${b});relation["natural"="water"](${b});way["building"](${b});way["highway"](${b});node["natural"="tree"](${b});` +
  // 3D buildings: parts with their own height and min_height (setbacks, towers), multipolygon buildings (courtyards)
  `way["building:part"](${b});relation["building:part"](${b});relation["building"](${b});` +
  EXTRA.map((q) => `${q}(${b});`).join('')).join('')});out geom qt;`;

/** Elements of a full Overpass dump that touch any of the corridor boxes. */
function fromDump(file, bs) {
  const els = JSON.parse(readFileSync(file, 'utf8')).elements;
  const rects = bs.map((b) => b.split(',').map(Number)); // s,w,n,e
  const hit = (lat, lon) => rects.some(([s, w, n, e]) => lat >= s && lat <= n && lon >= w && lon <= e);
  const wanted = (t) =>
    t.landuse || t.natural || t.building || t['building:part'] || t.highway || t.barrier || t.power || t.waterway || t.man_made ||
    t.amenity === 'bench' || t.amenity === 'shelter' || t.tourism || t.historic || t.sport === 'free_flying';
  return els.filter((el) => {
    if (!el.tags || !wanted(el.tags)) return false;
    if (el.lat !== undefined) return hit(el.lat, el.lon);
    const g = el.geometry ?? el.members?.flatMap((m) => m.geometry ?? []) ?? [];
    return g.some((p) => hit(p.lat, p.lon));
  });
}

async function overpass(q) {
  let last;
  for (let attempt = 0; attempt < 6; attempt++) {
    for (const url of ENDPOINTS) {
      try {
        const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: q }), headers: { 'User-Agent': 'serpentine-bake/0.1 (personal indoor cycling app)' }, signal: AbortSignal.timeout(120000) });
        if (!res.ok) throw new Error(`${url} ${res.status}`);
        return (await res.json()).elements;
      } catch (e) { last = e; }
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw last;
}

const r6 = (v) => Math.round(v * 1e6) / 1e6;
const pts = (g) => g?.map((p) => ({ lat: r6(p.lat), lon: r6(p.lon) }));
function compact(els) {
  return els.map((el) => {
    const tags = {};
    for (const k of KEEP) if (el.tags?.[k] !== undefined) tags[k] = el.tags[k];
    const o = { type: el.type, id: el.id, tags };
    if (el.lat !== undefined) { o.lat = r6(el.lat); o.lon = r6(el.lon); }
    if (el.geometry) o.geometry = pts(el.geometry);
    if (el.members) o.members = el.members.filter((m) => m.geometry).map((m) => ({ type: m.type, role: m.role, geometry: pts(m.geometry) }));
    return o;
  });
}

mkdirSync('public/osm', { recursive: true });
const index = JSON.parse(readFileSync('public/routes/index.json', 'utf8'));
const only = process.argv.slice(2).find((a) => !a.startsWith('--'));
const dump = process.argv.slice(2).find((a) => a.startsWith('--from='))?.slice(7);
const leadInOnly = process.argv.includes('--lead-in');
const addFiles = process.argv.slice(2).find((a) => a.startsWith('--add='))?.slice(6).split(',');
for (const { id } of index) {
  if (only && id !== only) continue;
  const route = JSON.parse(readFileSync(`public/routes/${id}.json`, 'utf8'));
  // the lead-in (scripts/bake-leadin.py) is ridden before the route, so its corridor is part of the world
  const line = leadInOnly ? (route.leadIn?.coords ?? []) : [...(route.leadIn?.coords ?? []), ...route.coords];
  if (line.length < 2) continue;
  const bs = boxes(line, CORRIDOR_OVERRIDE[id] ?? CORRIDOR);
  const seen = new Map();
  if (leadInOnly || addFiles) for (const el of JSON.parse(readFileSync(`public/osm/${id}.json`, 'utf8'))) seen.set(el.type + el.id, el);
  if (dump) for (const el of fromDump(dump, bs)) seen.set(el.type + el.id, el);
  for (const f of addFiles ?? []) for (const el of JSON.parse(readFileSync(f, 'utf8')).elements) if (el.tags) seen.set(el.type + el.id, el);
  for (let i = 0; !dump && !addFiles && i < bs.length; i += 3) {
    const els = await overpass(query(bs.slice(i, i + 3)));
    for (const el of els) seen.set(el.type + el.id, el);
    process.stdout.write('.');
  }
  // city skylines: tall buildings well beyond the corridor
  if (route.category === 'city' && !leadInOnly && !addFiles) {
    let s = 90, w = 180, n = -90, e = -180;
    for (const [lon, lat] of route.coords) { s = Math.min(s, lat); n = Math.max(n, lat); w = Math.min(w, lon); e = Math.max(e, lon); }
    const dLat = 2500 / 111320, dLon = 2500 / (111320 * Math.cos(((s + n) / 2) * Math.PI / 180));
    const bb = `${(s - dLat).toFixed(5)},${(w - dLon).toFixed(5)},${(n + dLat).toFixed(5)},${(e + dLon).toFixed(5)}`;
    const q = `[out:json][timeout:180][maxsize:536870912];(way["building"](if: number(t["height"]) >= 30)(${bb});way["building"](if: number(t["building:levels"]) >= 9)(${bb}););out geom qt;`;
    const tall = await overpass(q);
    for (const el of tall) seen.set(el.type + el.id, el);
    process.stdout.write(` +${tall.length} tall`);
  }
  const out = compact([...seen.values()]);
  const json = JSON.stringify(out);
  writeFileSync(`public/osm/${id}.json`, json);
  const count = (f) => out.filter(f).length;
  console.log(`\n${id}: ${out.length} elements, ${(json.length / 1e6).toFixed(2)} MB — forests ${count((e) => e.tags.landuse === 'forest' || e.tags.natural === 'wood')}, buildings ${count((e) => e.tags.building)}, roads ${count((e) => e.tags.highway)}`);
}
