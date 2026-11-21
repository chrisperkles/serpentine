# Serpentine

Personal indoor cycling app. Ride real roads in 3D on a smart trainer: real elevation, aerial photos, forests and villages from OpenStreetMap, structured workouts with ERG, Strava-ready `.fit` export. A Mac app, or locally in Chrome. No subscription.

## Install

Requires a Mac with Apple Silicon and macOS 12 or newer.

Download `Serpentine-<version>.dmg` from the [latest release](https://github.com/chrisperkles/serpentine/releases/latest), open it and drag Serpentine into Applications. On the first start it asks for your name, weight and FTP (not sure? keep the estimate and take the ramp test later). The first time you connect a trainer, macOS asks for Bluetooth access.

New versions arrive in the app. On start, Serpentine checks GitHub and installs a new version straight away, before you ride: a progress screen, then it restarts by itself (**Skip, update later** if you want to ride first). While it's open it checks every few hours; what it finds then downloads in the background and installs when you quit, never in the middle of a ride. **Serpentine ▸ Check for Updates…** checks right away.

Something not working? **Help ▸ Copy Diagnostics** copies the app and macOS versions, your saved Bluetooth devices and the end of the log, ready to paste into a message.

The app runs the same build as the Chrome version, in its own copy of Chromium, and serves it on `http://localhost:5198`. Rides, routes, workouts and plans are shared with the Chrome version through `~/Documents/Serpentine`. Riders and their settings are mirrored to `~/Documents/Serpentine/data/local-settings.json`, so a fresh install starts with them. Bluetooth works as in Chrome, with Serpentine's own device list: devices you picked reconnect on the next start without a click, each rider's own, and the app keeps looking for them for ten minutes after it opens, so pedalling the trainer awake or pressing a button on the Zwift Ride is enough (Settings ▸ Devices ▸ **Reconnect saved devices**).

## Start from the source

Double-click `Serpentine.command` (or `npm start`). It starts the local server on port 5199 and opens Chrome. Use Chrome or Edge: Safari has no Web Bluetooth. `npm run app` builds and opens the Mac app from the source instead.

Before pairing, quit Zwift and Zwift Companion. A trainer accepts only one controlling app at a time.

## Riding

- **Routes:** 14 baked presets in four kinds. Climbs: Großglockner, Gaisberg, Kitzbüheler Horn, Alpe d'Huez, Stelvio, Ventoux, Sa Calobra. Rolling: Wolfgangsee, Cap de Formentor. Flat: Wachau, Neusiedler See. City loops: Central Park, Sydney coast, Wiener Ringstraße. Drop any `.gpx` from Komoot/Strava/Garmin on the home screen, or use **Draw a route** (map + BRouter bike routing) to ride a local hill. Loops lap; point-to-point routes turn around at the end. Gaisberg starts with an easy 2.9 km lead-in from Gnigl up the B158 (switch it off under the route): the trainer stays light while you warm up, and the climb and its timer start in Guggenthal.
- **Training:** 20 built-in workouts grouped by type and length, an FTP ramp test that sets your FTP, four multi-week plans (Base builder, Climbing build, FTP builder, Keep fit) with today's workout on the home screen, a workout builder, and Zwift `.zwo` import/export.
- **Segments:** each route gets timed segments (full climb, steepest kilometre, hills, a sprint) with live delta to your record.
- **Pacers:** ride with bots at 2.0–4.0 W/kg; sitting in their draft cuts your drag by 30 %. With ERG on, the trainer holds the target power while you still move through the world. Without ERG, the real gradient drives the resistance.
- **Trainer difficulty:** the share of the real gradient sent to the trainer. 100 % feels every percent of the road; Zwift's default is 50 %. Change it mid-ride with `−` / `=` or the Ride's D-pad up/down.
- **Virtual gears:** 24 gears (Zwift's ratios 0.75–5.49, gear 12 neutral) or a real drivetrain (see Drivetrain below). On a KICKR Core Zwift One or Zwift Hub the trainer runs the gears natively over Zwift's trainer protocol; other FTMS trainers get them emulated through the gradient.
- **Hold watts:** the trainer holds a fixed power for the whole ride; the shifters change it by ±10 W. In ERG workouts the shifters scale intensity by ±5 %.
- **History:** every ride is saved as `.json` + Strava-ready `.fit` in `~/Documents/Serpentine/rides` (override with `SERPENTINE_DATA`). The History screen shows totals, weekly training load, climb records and best efforts.
- **Ride together:** friends on their own Macs ride the same route with you. **Ride together → Start a group ride** gives a five-letter code to send; they choose **Join** and type it. Everyone waits at the start until the leader starts the ride, then sets off on the same countdown; late riders start next to the group. You see each other in your kits with names and W/kg, the gaps, and you can sit in a friend's draft. Each ride is still your own in History and on Strava. How it works: [docs/multiplayer.md](docs/multiplayer.md).
- **Ghost:** your fastest summit on a route rides with you, with a live time gap.
- The ride starts as soon as you pedal. At the summit you roll back down and loop.
- **HUD for the saddle:** sized to read from about 2 m and scaled with the screen height. Top left is your effort (power, W/kg, cadence, heart rate, gear), top right the climb (gradient, VAM over the last 30 s, km and hm to the top, altitude, hairpin count), along the bottom the ride totals.
- **Nothing gets lost:** a ride in progress is kept in the browser every 5 s. If the laptop dies, the browser crashes or the page reloads, Home offers to carry on where you stopped, save the ride as it is, or discard it. While you ride the display stays awake, and leaving the page asks first. Unplugged at 20 % battery or less, a warning at the top of the screen (it stays when the HUD is hidden) tells you to plug in, with the time left, and a chime sounds at 20, 10 and 5 %.

Keys: `1`–`5` camera (chase, drone, moto, rider, cinematic) · `Space` pause · `E` ERG on/off · `Tab` skip interval · `[` `]` gears · `−` `=` difficulty · `↑` `↓` simulator watts (Shift = ±50) · `H` hide HUD · `Esc` end ride.

Zwift Ride: left hood shifts easier, right hood harder · D-pad up/down difficulty · D-pad left/right camera · A start / ERG · B pause · Y hide HUD · Z skip interval.

No trainer at hand? Turn on **Keyboard simulator** under Devices.

## Drivetrain

Settings → Drivetrain replaces Zwift's 24 virtual ratios with the gears of a real bike: road compact 50/34 11-32, semi-compact 52/36 11-30, standard 53/39 11-28, gravel 1x 40 10-44, or your own chainrings and cassette. With two chainrings the list follows how you really shift (small ring for the easy half, big ring for the hard half, no cross-chaining, near-duplicate ratios removed). The HUD shows the gear as `34×28`. The ratio sent to the trainer is chainring/cog, scaled by the wheel circumference against the KICKR's 700c reference. The settings page shows speed and watts at 60 rpm in your easiest gear on 5 / 10 / 15 %; for a realistic feel set trainer difficulty to 100 % (**Real road feel** button).

## Strava segments

Preset routes can show their Strava segments with the KOM and your PR, live deltas on the HUD, and ghost riders at KOM pace and at your PR pace. Strava's leaderboards are not open to third-party apps, so this uses the official API only: segment details (`xoms`, your `athlete_segment_stats`), explore and starred segments. Nothing is scraped; times are labelled "from Strava".

1. Create an API application at <https://www.strava.com/settings/api>. Authorization Callback Domain: `localhost`.
2. Open Settings → Strava, paste the Client ID and Client Secret, Save, then **Connect to Strava** and approve. The callback is `http://localhost:5199/api/strava/callback` (`http://localhost:5198/…` in the Mac app); the callback domain `localhost` covers both.
3. Pick a preset route (first the Gaisberg): the Ride tab lists the segments found on it and offers KOM / PR ghosts. Starting the ride merges them into the route's segments.

Credentials and tokens are stored in `strava.json` in the data folder (`~/Documents/Serpentine`, or `SERPENTINE_DATA`), never in the repo, and refreshed automatically. Segments per route are cached for 7 days in `strava-segments-<route>.json` (`/api/strava/segments?route=gaisberg&refresh=1` forces a refresh). On a Strava rate limit (HTTP 429) the cached list is served. Segment positions along the route are computed on the raw route coordinates with haversine distances, which is within a fraction of a percent of the resampled route the app rides.

## Trainers

Bluetooth FTMS (Wahoo, Tacx, Elite, Saris, Zwift Hub, … — most trainers since ~2020), Tacx FE-C over BLE for older Tacx, Bluetooth power meters and heart-rate straps. KICKR Core Zwift One / Zwift Hub additionally speak Zwift's trainer protocol for native virtual shifting.

Zwift Ride controllers connect directly (no Zwift needed). Ride firmware 1.3+ hides its service until it has been connected in the Zwift app within the last ~24 h. Protocol sources: Makinolo's Zwift Ride and Zwift Trainer protocol write-ups, qdomyos-zwift, Incyclist's `zwift_hub.proto`, BikeControl.

## Graphics

Terrain is real elevation (bicubic-smoothed) textured with orthophotos; near the camera the photo only supplies colour and procedurally painted, mipmapped grass/rock/gravel detail with bump lighting takes over, steep faces get tri-planar rock. OSM land cover (meadow, built-up, water) steers the ground shading and the grass. OSM water and the sea are rendered with reflections and sun glints. Resolution adapts automatically to hold the frame rate (60 fps by default, 30 or 120 under Settings). A reversed depth buffer keeps precision from the front wheel to the horizon and lets the GPU skip hidden pixels: on the forest climbs an M5 Max holds 60 fps at full sharpness with the GPU about 63 % busy (it was flat out at 44 fps with the earlier logarithmic depth buffer). Unplugged, a battery saver runs at 30 fps and drops Beautiful to Balanced (GPU about 36 % busy).

Lighting: the real terrain casts shadows (a DEM heightfield around the route is ray-marched towards the sun on the GPU, `TerrainShadow.ts`), clouds cast moving shadows, N8AO ambient occlusion grounds everything, and the sun's shadow map follows the rider. The **Nebelmeer** time of day adds an autumn valley-fog inversion: you climb out of the grey fog into sunshine and look over a sea of fog from the top.

Distant trees are impostors rendered at start-up from the near models (crossed cards plus a top card), so forests keep their texture to the horizon and read as closed canopy from a drone. Under the canopy the ground turns into shaded forest floor with leaf litter and Poly Haven ferns. PBR materials (bike, cars, rails, props) get image-based light rendered from the current sky.

Trees: presets can ship real trees baked from the Meta/WRI 1 m canopy height map with Copernicus leaf type (`public/trees/<id>.bin`, `scripts/bake-trees.py`): every spruce and beech at its real position and height, forest-edge trees keep their low branches. Without a bake, OSM forest polygons are filled. Foliage, grass and bark come from a photographic atlas composed from CC0 scans (`public/textures/foliage.png`, `scripts/bake-foliage.py`); leaf colour follows today's date (beeches colour from the tree line down in October, larches turn gold).

Biomes (`src/engine/biome.ts`) switch the whole look by region. Alpine: spruce, beech, mown meadows, W-beam rails, Flachgau houses. Mediterranean (e.g. Cap de Formentor): Aleppo pines, holm oak and wild olive, carritx tussocks, mastic shrubs, dwarf fan palms, bare limestone, dry-stone parapets, Mallorcan houses with green shutters, the photographed sea colour and an open sea to the horizon. Road tunnels from OSM get a rough rock bore with ceiling lamps. `scripts/match-shots.mjs` renders the game camera from the exact position and heading of street-level photos for side-by-side comparison.

Buildings follow the regional style (Salzburg Flachgau): plaster with a wooden upper storey or gable, wide overhangs, gabled / hipped / half-hipped roofs from OSM `roof:shape`, balconies with geraniums, windows with shutters and sky reflections.

Road: CC0 asphalt scan with cracks and patches, Austrian markings (6 m dashes / 12 m gaps), delineator posts with red reflectors on the right and white on the left (StVO §57), W-beam guard rails wherever the ground drops away and on hairpin outsides, chevron boards at hairpins.

Blender-built models (`public/models`, generated from scripts through the Blender MCP add-on): the Sender Gaisberg transmitter at its OSM position, the summit cross, benches, bus stops, yellow guideposts, wayside crosses, info boards, power poles (wires are drawn between the OSM poles), firewood stacks, Pinzgauer cattle, paragliders, cars and motorbikes, a detailed road bike and rider body parts, and photo-scanned rocks (Poly Haven, decimated). Per-route placements live in `public/scenes/<id>.json`.

Life: paragliders thermal over the real take-off sites, cattle graze on OSM meadows, jackdaws circle the summit, hikers stand at the viewpoints and walk the OSM footpaths, cars and motorbikes come down the road and the odd car overtakes. The summit car park is filled from its OSM polygon (cars kept clear of the road), with the bus at the turnaround.

Note: textures are painted on software 2D canvases (`willReadFrequently`) — GPU-accelerated 2D canvas work corrupted WebGL output on Chrome/ANGLE/Metal.

## Licence

Code: MIT (see `LICENSE`). Bundled data keeps its own licence, see the table below: OpenStreetMap extracts in `public/osm` are © OpenStreetMap contributors under the ODbL; `public/trees` is derived from the Meta/WRI Global Canopy Height map (CC BY 4.0) and Copernicus HRL data; textures and scanned models derived from Poly Haven and ambientCG are CC0. Map imagery and elevation are fetched at runtime from their providers and are not part of this repository.

Not affiliated with Zwift. Trainer protocol support is based on public community write-ups (see Trainers).

## Data sources

| What | Source |
| --- | --- |
| Elevation | AWS Terrain Tiles (Terrarium), 10 m DTM in Austria |
| Aerial photos | basemap.at Orthofoto in Austria (CC BY 4.0), Esri World Imagery elsewhere |
| Forests, buildings, roads | OpenStreetMap via Overpass (© OpenStreetMap contributors, ODbL) |
| Routing | BRouter |
| Tree positions / heights (Gaisberg) | Meta & WRI Global Canopy Height v2, 1 m (CC BY 4.0) |
| Leaf type (Gaisberg) | Copernicus HRL Dominant Leaf Type 2018, 10 m |
| Foliage, bark, asphalt, rocks | Poly Haven and ambientCG scans (CC0) |
| Aerial photos (Spain, Balearics) | IGN PNOA Máxima Actualidad, 25 cm (CC BY 4.0) |
| Elevation (Formentor) | IGN MDT05, 5 m, baked to `public/dem` by `scripts/bake-dem.py` (CC BY 4.0) |
| Street-level references (Formentor) | KartaView (CC BY-SA 4.0) and Wikimedia Commons, used for comparison only, not shipped |

Preset OSM data is baked into `public/osm` because the public Overpass servers are often overloaded. Imported routes query Overpass live (chunked, with fallbacks) and cache the result in IndexedDB.

## Development

```sh
npm run dev           # Vite on :5199
npm run typecheck
npm run bake-routes   # re-fetch preset routes from BRouter
npm run bake-osm      # re-bake OSM corridors for presets
npm run e2e           # Playwright: home → ride → summary → .fit (dev server must run)
npm test              # unit tests (devices, drivetrain, FIT, Strava, training, workouts, ride session, group-ride relay) and the local API
npm run check         # typecheck (app + Mac app) and npm test, what CI runs on every push
node scripts/shots-set.mjs <prefix> 9900:cinematic 3200:chase:inversion   # QA stills, HUD hidden
node scripts/hud-shots.mjs <prefix>                                          # HUD as read from the saddle (2 m)
node scripts/flyover.mjs inversion 48 shots/gaisberg/flyover.mp4           # scripted drone film (ffmpeg)
npm run app           # build, then open the Mac app from the source (port 5198)
npm run app:typecheck
npm run app:dist      # signed .app, DMG and ZIP in dist-app/ (no notarization without NOTARY env, see docs/releasing.md)
```

Bakes that need a Python venv with rasterio, numpy, scipy, pyproj, pillow (not part of the app):

```sh
python scripts/bake-trees.py gaisberg <chm.tif> <dlt.tif>   # real trees from a canopy height model
python scripts/bake-foliage.py <assets dir>                  # foliage atlas from CC0 scans
node scripts/bake-osm.mjs gaisberg --from=<overpass dump>    # rich OSM bake from a local dump
```

A lead-in is baked in four steps: `python3 -I scripts/bake-leadin.py gaisberg` (follows the B158 in OSM),
`node scripts/bake-osm.mjs gaisberg --lead-in`, `python scripts/bake-trees.py gaisberg <chm.tif> <dlt.tif> --lead-in`
(a canopy crop that covers the lead-in) and `node scripts/bake-turnarounds.mjs gaisberg`.

`?ride=<preset>&sim=1&workout=<id>&at=<metres>&cam=drone&time=golden` starts a ride directly (used for screenshots). It skips the lead-in so `at` stays in route metres; add `&leadin=1` to ride it. `&group=new` opens a group ride on it, `?group=<CODE>&sim=1` joins one, `&relay=ws://127.0.0.1:8787` uses a local relay (`relay/`, see [docs/multiplayer.md](docs/multiplayer.md)).

Layout: `src/geo` (projection, DEM, imagery, OSM, routes), `src/engine` (Three.js terrain LOD, road, trees, buildings, rider, sky, camera), `src/devices` (Web Bluetooth), `src/workouts`, `src/training` (plans, ramp test), `src/sim` (physics, session, stats, FIT, storage), `src/audio`, `src/ui`, `electron` (the Mac app: local server, Bluetooth chooser and reconnect, updates, icon). Releasing the app: [docs/releasing.md](docs/releasing.md). What comes next: [docs/ROADMAP.md](docs/ROADMAP.md).

Visual work follows a brief-first, separate-reviewer loop: see [CLAUDE.md](CLAUDE.md) for the rules, [docs/art/](docs/art/README.md) for the art direction, per-route briefs and the review scorecard, and [docs/lessons.md](docs/lessons.md) for what past fixes taught us.
