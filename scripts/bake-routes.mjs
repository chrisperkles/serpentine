// Fetches preset routes from BRouter (OSM bike routing) and stores them as
// compact JSON in public/routes.
//   node scripts/bake-routes.mjs            bake presets that have no file yet
//   node scripts/bake-routes.mjs <id>       re-bake only that preset
//   node scripts/bake-routes.mjs --all      re-bake everything
// index.json is updated in place (entries of other routes are kept).
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';

// category: 'climb' (trimmed at the highest point) | 'rolling' | 'flat' | 'city'
// loop: last coordinate is forced to equal the first. `to` may be omitted for loops.
// via: any number of [lon, lat]; profile defaults to fastbike.
const PRESETS = [
  { id: 'grossglockner', name: 'Großglockner Hochalpenstraße', region: 'Salzburg, AT', category: 'climb', loop: false, from: [12.8297, 47.2276], to: [12.8424, 47.0826], via: [[12.8121, 47.1263]] },
  { id: 'gaisberg', name: 'Gaisberg', region: 'Salzburg, AT', category: 'climb', loop: false, from: [13.0939, 47.8167], to: [13.1110, 47.8050] },
  { id: 'kitzbueheler-horn', name: 'Kitzbüheler Horn', region: 'Tirol, AT', category: 'climb', loop: false, from: [12.3925, 47.4470], to: [12.4423, 47.4566] },
  { id: 'alpe-dhuez', name: "Alpe d'Huez", region: 'Isère, FR', category: 'climb', loop: false, from: [6.0302, 45.0557], to: [6.0700, 45.0919] },
  { id: 'stelvio', name: 'Passo dello Stelvio', region: 'Südtirol, IT', category: 'climb', loop: false, from: [10.5917, 46.6195], to: [10.4530, 46.5286] },
  { id: 'ventoux', name: 'Mont Ventoux (Bédoin)', region: 'Provence, FR', category: 'climb', loop: false, from: [5.1797, 44.1246], to: [5.2789, 44.1741] },
  // Melk → Krems on the north bank (B3 via Emmersdorf bridge, Willendorf, Spitz, Weißenkirchen, Dürnstein)
  { id: 'wachau', name: 'Wachau', region: 'Niederösterreich, AT', category: 'flat', loop: false, from: [15.3370, 48.2272], to: [15.6004, 48.4108], via: [[15.3384, 48.2419], [15.4049, 48.3228], [15.5190, 48.3945]] },
  // Weiden → Podersdorf → Illmitz → Apetlon, lakeside/Seewinkel cycle paths
  { id: 'neusiedler-see', name: 'Neusiedler See', region: 'Burgenland, AT', category: 'flat', loop: false, profile: 'trekking', from: [16.8679, 47.9262], to: [16.8332, 47.7433], via: [[16.8341, 47.8571], [16.8008, 47.7611]] },
  // St. Gilgen → Strobl → St. Wolfgang (no road link back along the north shore, so one-way)
  { id: 'wolfgangsee', name: 'Wolfgangsee', region: 'Salzkammergut, AT', category: 'rolling', loop: false, from: [13.3643, 47.7670], to: [13.4483, 47.7379], via: [[13.4835, 47.7170]] },
  { id: 'formentor', name: 'Cap de Formentor', region: 'Mallorca, ES', category: 'rolling', loop: false, from: [3.0828, 39.9080], to: [3.2123, 39.9614] },
  { id: 'sa-calobra', name: 'Sa Calobra', region: 'Mallorca, ES', category: 'climb', loop: false, from: [2.7999, 39.8504], to: [2.8162, 39.8317] },
  // Counter-clockwise: East Drive north, Harlem Meer, West Drive south, Center Drive back east. Vias sit on the drives.
  { id: 'central-park', name: 'Central Park Loop', region: 'New York, US', category: 'city', loop: true, from: [-73.9722, 40.7695], via: [[-73.9665, 40.7781], [-73.9591, 40.7839], [-73.9573, 40.7897], [-73.9553, 40.7990], [-73.9592, 40.7946], [-73.9627, 40.7915], [-73.9670, 40.7876], [-73.9700, 40.7807], [-73.9742, 40.7770], [-73.9770, 40.7727], [-73.9799, 40.7692], [-73.9786, 40.7677], [-73.9774, 40.7672], [-73.9758, 40.7684], [-73.9745, 40.7698]] },
  // Bondi → Bronte → Coogee coast roads, Randwick, through Centennial Park, Oxford St back to Bondi
  { id: 'sydney', name: 'Sydney Coast & Park', region: 'Sydney, AU', category: 'city', loop: true, from: [151.2743, -33.8908], via: [[151.2680, -33.9040], [151.2665, -33.9140], [151.2587, -33.9210], [151.2420, -33.9150], [151.2290, -33.8960], [151.2480, -33.8890]] },
  { id: 'vienna-ring', name: 'Wiener Ringstraße', region: 'Wien, AT', category: 'city', loop: true, from: [16.3823, 48.2090], via: [[16.3786, 48.2057], [16.3762, 48.2033], [16.3742, 48.2016], [16.3698, 48.2023], [16.3677, 48.2028], [16.3628, 48.2043], [16.3615, 48.2124], [16.3637, 48.2145], [16.3671, 48.2158], [16.3737, 48.2149], [16.3766, 48.2123], [16.3790, 48.2116]] },
];

const args = process.argv.slice(2);
const all = args.includes('--all');
const only = args.find((a) => !a.startsWith('--'));
if (only && !PRESETS.some((p) => p.id === only)) { console.error(`unknown preset ${only}`); process.exit(1); }

const hav = (a, b) => {
  const r = Math.PI / 180;
  const h = Math.sin(((b[1] - a[1]) * r) / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(((b[0] - a[0]) * r) / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(h));
};

/**
 * A via point a few metres off the road makes the router ride out to it and straight back: a dead-end spur where
 * the rider turns on the spot, twice. Wherever the line comes back to a point it left less than `reach` metres
 * of riding ago, the detour is cut out. On a loop the start can be such a spur too (out from the first point,
 * back to it at the end): then the loop closes where the spur left the road.
 */
function despur(coords, loop, reach = 120) {
  const out = coords.map((c) => [...c]);
  let cut = 0;
  for (let i = 0; i < out.length - 2; i++) {
    let run = 0, last = -1;
    for (let j = i + 1; j < out.length && run < reach; j++) {
      run += hav(out[j - 1], out[j]);
      if (j > i + 1 && hav(out[i], out[j]) < 0.6) last = j;
    }
    if (last > 0) { cut += last - i; out.splice(i + 1, last - i); }
  }
  if (loop) {
    while (out.length > 6 && hav(out[1], out.at(-2)) < 0.6) { out.shift(); out.pop(); cut += 2; }
    out[out.length - 1] = [...out[0]];
  }
  return { coords: out, cut };
}

mkdirSync('public/routes', { recursive: true });
const indexPath = 'public/routes/index.json';
const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : [];
// --despur: clean the spurs out of an already baked route without asking the router again
if (args.includes('--despur')) {
  for (const p of PRESETS) {
    if (only && p.id !== only) continue;
    const file = `public/routes/${p.id}.json`;
    if (!existsSync(file)) continue;
    const route = JSON.parse(readFileSync(file, 'utf8'));
    const { coords, cut } = despur(route.coords, route.loop);
    let len = 0;
    for (let i = 1; i < coords.length; i++) len += hav(coords[i - 1], coords[i]);
    console.log(`${p.id.padEnd(20)} ${cut} points in spurs, ${route.lengthKm} → ${(len / 1000).toFixed(2)} km`);
    if (!cut || !only) continue;
    route.coords = coords;
    route.lengthKm = +(len / 1000).toFixed(2);
    writeFileSync(file, JSON.stringify(route));
    const e = index.find((x) => x.id === p.id);
    if (e) Object.assign(e, { lengthKm: route.lengthKm, startEle: coords[0][2], endEle: coords.at(-1)[2] });
    writeFileSync(indexPath, JSON.stringify(index, null, 2));
  }
  process.exit(0);
}
let failed = false;
for (const p of PRESETS) {
  if (only ? p.id !== only : !all && existsSync(`public/routes/${p.id}.json`)) continue;
  const to = p.to ?? (p.loop ? p.from : null);
  if (!to) throw new Error(`${p.id}: missing "to"`);
  const pts = [p.from, ...(p.via ?? []), to].map(([lon, lat]) => `${lon},${lat}`).join('|');
  const url = `https://brouter.de/brouter?lonlats=${pts}&profile=${p.profile ?? 'fastbike'}&alternativeidx=0&format=geojson`;
  let res;
  for (let attempt = 0; attempt < 4; attempt++) {
    res = await fetch(url);
    if (res.ok) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (!res.ok) { console.error(p.id, res.status, await res.text()); failed = true; continue; }
  const gj = await res.json();
  const f = gj.features[0];
  let coords = f.geometry.coordinates.map(([lon, lat, ele]) => [+lon.toFixed(6), +lat.toFixed(6), +(ele ?? 0).toFixed(1)]);
  if (p.category === 'climb') {
    // a climb finishes at its highest point
    const top = coords.reduce((best, c, i) => (c[2] > coords[best][2] ? i : best), 0);
    if (top > coords.length * 0.8) coords = coords.slice(0, top + 1);
  }
  if (p.loop) {
    const gap = hav(coords[0], coords.at(-1));
    if (gap > 30) throw new Error(`${p.id}: loop does not close (${gap.toFixed(0)} m gap)`);
    if (gap > 0) coords.push([...coords[0]]);
    else coords[coords.length - 1] = [...coords[0]];
  }
  coords = despur(coords, p.loop).coords;
  let len = 0;
  for (let i = 1; i < coords.length; i++) len += hav(coords[i - 1], coords[i]);
  const lengthKm = +(len / 1000).toFixed(2);
  const gain = +f.properties['filtered ascend'];
  const out = { id: p.id, name: p.name, region: p.region, category: p.category, loop: p.loop, source: 'brouter', lengthKm, gain, coords };
  writeFileSync(`public/routes/${p.id}.json`, JSON.stringify(out));
  const entry = { id: p.id, name: p.name, region: p.region, category: p.category, loop: p.loop, lengthKm, gain, startEle: coords[0][2], endEle: coords.at(-1)[2] };
  const at = index.findIndex((e) => e.id === p.id);
  if (at >= 0) index[at] = entry; else index.push(entry);
  console.log(`${p.id.padEnd(20)} ${String(lengthKm).padStart(6)} km  +${gain} m  ${coords[0][2]} → ${coords.at(-1)[2]} m  (${coords.length} pts)`);
}
index.sort((a, b) => PRESETS.findIndex((p) => p.id === a.id) - PRESETS.findIndex((p) => p.id === b.id));
writeFileSync(indexPath, JSON.stringify(index, null, 2));
if (failed) process.exit(1);
