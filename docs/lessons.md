# Lessons

Every fix adds an entry here, so the next route (and the next session) starts smarter. Each entry gives the
symptom (what it looked like), cause, fix and where. Newest at the bottom of each section.

## Rendering and shaders

- **GLSL redefinition errors on GLB models.** A material was patched twice (loaded model plus its clone). Fix:
  `patchMaterial` is idempotent through an `atmo` flag. Where: `src/engine/atmosphere.ts`.
- **Black environment lighting.** `PMREMGenerator.fromScene` uses a default far plane of 100, smaller than the sky
  radius. Fix: `fromScene(scene, 0.04, 0.5, 3000)`. Where: `Engine.updateEnvironment`.
- **Bloom blacks out the whole frame.** GLSL `pow()` of a negative base gives NaN, and bloom spreads it. Fix: clamp
  the bases before `pow`.
- **WebGL frame turns white or washed out.** A 2D canvas read back on ANGLE/Metal. Fix:
  `getContext('2d', { willReadFrequently: true })`.
- **Pines rendered white.** The bark-tint exclusion covered all of v < 0.5 of the atlas. Fix: restrict it to the
  bark cell (`uv.y` 0.25–0.5, `uv.x` < 0.5). Where: `treeModels.ts` `preserveCoverage`.
- **Every house turned brown.** A shared `THREE.Color` constant was mutated for the alm timber. Fix: clone shared
  colours before changing them.
- **Hard square shadow on the summit meadow.** It was the real transmitter platform, not a bug; the hard edge came
  from the shadow-map border. Fix: fade shadows near the shadow-map edge (`atmoShadowFade`). Lesson: check reality
  before "fixing" a shadow.
- **Grey band along the road edge.** The road's shoulder alpha ramp was wide and light (the terrain wasn't the
  cause). Fix: a narrow, dark gravel seam. Where: `Road.ts`.
- **The GPU ran flat out, even on an M5 Max (45–57 fps at 1×, 31 fps at full Retina).** The logarithmic depth
  buffer writes `gl_FragDepth` in every fragment shader, which switches off early depth testing and the hidden-surface
  removal of Apple's tile GPUs: every hidden tree card and blade of grass was shaded. Fix: a reversed float depth
  buffer (`reversedDepthBuffer`, needs `EXT_clip_control`) keeps the near-to-horizon precision without depth writes.
  Forest climb: 31 → 87 fps at 2×; at the real settings 44 fps at 1× → a steady 60 fps at 1.6×, GPU busy 89 % → 63 %.
  Trees went from the dearest feature (+40 % fps when hidden) to nearly free. Where: `Engine` constructor.
- **Reversed depth: black frame, then darkened slopes, then self-shadowed walls.** Three library gaps, each found
  by rendering the same paused frame with `?depth=log` and without and diffing (`atmo.uTime` fixed, AO and sun
  shadows toggled one at a time). A bare `THREE.Camera` throws when three re-projects it (use an
  `OrthographicCamera`, `TerrainShadow.ts`); N8AO 2.0.1's full-screen quads depth-test and fail, and its post pass
  builds the half-res depth shader without `REVERSEDEPTH` (wrong normals); three 0.186's PCF shadow lookup adds the
  bias without flipping it. Fixes in `Engine` (AO render wrapper, `shadow.bias` sign). After them the frames match
  to under 1/255 on average at six spots. Re-check with `?depth=log` after upgrading three or N8AO.
- **The second tunnel was dark but had no portal cut.** The tunnel shader handled only a route's first tunnel.
  Fix: per-tunnel spans, bounds and lamp flags in one point list (`MAX_TUNNELS` 4). Where: `atmosphere.ts`
  `TUNNEL_GLSL`, `Tunnel.ts`.
- **Sa Calobra's road cuts looked like smooth beige plaster.** Most of a "cut" is the ~50° bank above the rock
  face, which the karst shader kept as garrigue, and the cliff scan leans warm ochre (right for Formentor, wrong for
  grey Tramuntana limestone). Fix: per-route `biomeTweaks` in `scenes/<id>.json` (`cliffSlope` where the scan takes
  over, `rockOchre`); grey rock is lifted and its streaks flattened. Where: `biome.ts`, `terrainMaterial.ts`.
- **Stelvio's forest floor and pastures were white.** basemap.at answers tiles outside Austria at zoom 12–15
  and 18 with white JPEGs (2.4 KB, decoded as 253 in Chrome), not 404s, and the size check only caught placeholders
  under 800 bytes. Stelvio lies inside the bounds box used for Austria. Lesson: when ground looks wrong, dump the
  tile textures off the terrain meshes before tuning the shader (two shader "fixes" changed nothing). Fix: a tile
  that is over a tenth near-white and neutral falls back to Esri; a national source that only misses for a world is
  skipped. Where: `src/geo/imagery.ts`.
- **Alpe d'Huez and Bédoin had Salzburg farmhouses** (green shutters, geraniums). Fix: building styles are data
  (palettes, pitch, timber storeys, balcony kind, shutter colours) picked by the biome's `buildings`, overridable in a
  scene's `biomeTweaks` (`savoie`, `provence`). Where: `Buildings.ts` `STYLES`, `scenes/<id>.json`.
- **Mont Ventoux had no summit tower.** OSM towers and masts were skipped as buildings and only appeared where a
  scene placed a model. Fix: communication towers render as shaft, drum and banded antenna, small mapped masts as
  steel poles; towers near a scene model are left to it; industrial blocks are bare concrete. Where: `osm.ts`
  `towers`, `Props.towers`.
- **Shaded slopes went near-black** (Großglockner valley, Kitzbüheler Horn pastures). Not AO, terrain or cloud
  shadows (toggling each changed nothing): the orthophoto is near-black there itself (the flight's shadows), and a
  face turned from our sun only gets skylight. Fix: divide out the photo's summer-midday sun by the terrain normal,
  lift photo shadows to a floor of 0.085 (was 0.055), and add light bounced off the lit slopes opposite to faces
  turned from the sun. Shade is 20–35 % brighter, sunlit flats unchanged. Measure pixel means in a fixed box: the
  change is easy to miss on a contact sheet. Where: `terrainMaterial.ts`.
- **Grass read as tall spiky blades on every Alpine verge.** Fix: the verge (1.8 m from the asphalt) gets low mown
  tufts, and Alpine tufts are wider than tall (height factor 1.1 → 0.82); carritx unchanged. Where: `GroundCover.ts`.
- **Every tuft was half black ("dark olive spikes", flagged on all six new routes).** The grass cards carry an up
  normal so they light like the ground, but three.js flips the normal on the back faces of double-sided materials,
  so every card seen from behind was unlit. Fix: tufts keep their normal on back faces, and each tuft takes the
  ground normal under it (instanced `gNormal`), so on a shaded bank it is as dark as the turf, not a bright clump.
  Check any double-sided card material with a faked normal for the same flip. Where: `GroundCover.ts`.
- **Shaded meadow was teal** (blue above green: Kitzbüheler Horn banks 68/95/82, Wolfgangsee verge 61/80/83). The
  photo's own shadows are blue already and the sky fill added more. Fix: the terrain's indirect light loses 20 % of
  its blue, so shade is a darker ground colour. Where: `terrainMaterial.ts` (aomap_fragment).
- **Lakes were a pale white sheet from the road.** At a grazing view the fresnel reflection is mostly the horizon
  sky, which is pale. In the Alps the low reflected rays hit the mountains across the lake. Fix: low reflected rays
  take a dark, hazed shore colour, steeper ones the sky (sea unchanged). Where: `terrainMaterial.ts` water block.

## Placement and geometry

- **Floating trunks and buildings.** They were placed on the raw DEM, but the road corridor is flattened. Fix:
  place with `terrain.groundHeight`. Where: `Vegetation.ts`, `Buildings.ts`.
- **Huge smeared carve beside the road.** The cut band reached far beyond the road. Fix: limit cut and fill to
  about 10 m and blend back to the natural slope. Where: `Terrain.flatten`.
- **Blue sky strip at the bottom of the tunnel.** The bore had no floor. Fix: a closed floor profile. Where: `Tunnel.ts`.
- **Paved discs inside real roundabouts.** A synthetic fill was drawn into loops OSM already has. Fix: removed;
  only synthesised turning circles get pavement.
- **Fake sea on coastal flats.** The "dark and flat" photo test caught shaded farmland. Fix: a stricter threshold
  where photo-sea is on, and never on canopy or verge. Where: `terrainMaterial.ts`.
- **The Nus de sa Corbata was a flat X-junction.** The DEM gives both passes of a self-crossing one height. Fix: a
  route `underpasses` entry; the loader finds the crossing in world space (a hand-measured s was 37 m off), drops
  the lower pass 7 m over the 160 m before it, builds a short underpass whose bore is the Blender bridge, and gives
  the ground under the bridge a flat floor (sloped terrain triangles stuck out of the arch as pale spikes before).
  Where: `route.ts` `findUnderpasses`, `Tunnel.ts`, `Terrain.flatten`.
- **No retaining walls although OSM has 168 on Sa Calobra.** They are hillside terrace walls (marges), a median
  120 m from the road; OSM rarely maps a road's own walls. And the old test read the ground at the wall line, which
  is flattened to the road, so every wall looked "at road level". Fix: classify walls by the ground 3 m further out,
  and face road cuts with masonry where the scene says so (`cutWalls` spans, cuts over 2.5 m), at the asphalt edge
  with a battered foot that hides the terrain's coarse teeth at the cut base. Where: `Roadside.ts` `cutWalls`.
- **A conifer hung in the air over the road in the knot's loop.** Trees stood on the flattened ground where the road
  cut had removed theirs (or on fresh fill), and the coarse terrain mesh showed the slope below them. Fix: no tree
  where the road works moved the ground more than 1.5 m (2.6 % of Sa Calobra's trees, under 1 % elsewhere).
  Where: `Vegetation.placeBaked` (`rawHeightAt`).
- **Großglockner ended in the middle of the Hochtor tunnel** and its turning circle sat on the ridge above:
  BRouter trims a climb at its highest sample, which was inside the tunnel. Fix: `bake-turnarounds` runs a route
  that stops inside a tunnel on to the far portal and ~70 m beyond (following the short OSM ways there), so the
  tunnel is found and ridden whole. Where: `scripts/bake-turnarounds.mjs` `throughTunnel`.
- **Kitzbüheler Horn ran 1.45 km past the end of the road** on a track, the Karstweg footpath and gravel. Check
  which OSM highways the last kilometres follow before trusting a climb's end. The first trim cut at the junction
  where the BRouter line left the paved road, 680 m and 70 m of climbing short of the Alpenhaus: the Panoramastraße
  went on. Follow the named road to its real end, not to where the GPX turned off. Fix: the paved ways on to the
  Alpenhaus are appended from OSM with DEM heights (10.13 km). Old ride times include the footpath.
- **Turnarounds stood on a plateau with a step where they met the road.** The smoothed profile ends metres below the
  raw DEM on a climb, the loop took raw DEM heights, only one end was pinned, and the square end of the asphalt left a
  wedge of ground showing where the loop leaves at an angle. Fix: the loop follows the DEM's shape measured from the
  end point, pinned at both ends; the route's ribbon runs one sample under the loop, which draws with more depth
  bias. Where: `route.ts` `samplePath`, `Road.ts`.
- **Houses stood on the road in old towns** (St. Wolfgang, Kitzbühel): OSM footprints reach the street edge and
  our ribbon is wider than the real street. Fix: a building whose footprint comes within the asphalt is left out.
  Where: `Buildings.ts` `reachesRoad`.
- **A wall crossed the road at the Hochtor.** Alpine OSM walls and fences were drawn without a road check. Fix: no
  barrier piece on the carriageway, and retaining walls at the road edge are left to Roadside. Where: `Props.fences`.
- **Mont Ventoux's white top was a meadow of grass tufts.** OSM scree and bare rock were parsed (class `rock`) but
  never drawn into the land mask, and OSM maps little scree along the Ventoux road anyway. Fix: rock goes into the
  canopy mask's blue channel (terrain: stone, no meadow push; ground cover: bare but for the odd boulder), and a
  scene's `biomeTweaks.bareAbove` does the same above a height (Ventoux 1450 m, above Chalet Reynard). Where:
  `Engine.buildWaterMask`, `terrainMaterial.ts`, `GroundCover.ts`.
- **Editing `src/` during a shot batch broke a capture** (fps 0, no tiles) and mixed two versions in one set.
  Re-shoot the whole set after the last edit.

- **A meadow shed stood as a white two-storey house with a flower box** (Kitzbüheler Horn km 4.7, "invented
  landmark"). OSM had a 24 m² `building=yes`; untagged buildings default to 7 m. Fix: footprints under 40 m² without
  height tags are one storey, and untagged unnamed ones are sheds (timber); `building=container` and
  `building=service` are low bare boxes (the Hochtor "chalet", a 9 m² Ventoux substation that stood as a 7 m tower).
  Where: `osm.ts`, `Buildings.ts`.
- **The "Alpenhaus" the reviewer saw (white chalets) were two farm buildings by the old route end;** the real one
  stood 680 m further up the road, out of shot. Fix: the route goes on to it (see Data and bakes). OSM maps a 713 m²
  footprint inside the 1448 m² one; the scene's `osmTags` set `building=no` on the nested one (now honoured) and dark
  timber walls and grey metal roofs on the rest. A Blender model was built first and dropped: the ground falls 10 m
  across the footprint and a model sits at one height, while the OSM building drops its walls to the lowest corner
  like the real downhill façade. Where: `public/scenes/kitzbueheler-horn.json`.
- **Road text crossed by the centre line ("KØM").** The painted word spanned the whole road, so the centre dashes
  ran through the O. Fix: road text goes in the rider's lane, between the centre line and the edge line, as real
  road text does; the lane strip's own aspect (2.3 m by 7 m) already stretches the letters about three times along
  the road. Where: `SegmentMarks.ts` (`paintStrip` lane offsets).
- **Finish chequer read as one thin stripe at the summit.** The band straddled the segment end, and at the end of the
  route the second half fell off the road. Fix: at the route's end the band ends on the line. Where: `SegmentMarks.ts`.
- **Arch feet hanging in the air or the tube showing under them.** The ballast sat at road height on verges that
  fall away. Fix: each foot sits on `groundHeight` at its own spot, deep enough (0.75 m) that the tube never shows
  below it on a slope. Where: `SegmentMarks.ts` `arch`.
- **A segment starting at the route's first metre never timed** (the full climb without the lead-in). The start test
  was `prevS < start`, and a ride starts at exactly 0. Fix: `prevS <= start && s > start`. Where: `session.ts`
  `updateSegments`.

## Data and bakes

- **Turnaround bake found no loop.** `shortestCycle` returned `[]`, which is not null. Fix: a simple-cycle DFS with
  an explicit null, entry at the nearest end, a spur-trim limit of 150 m, and tunnels recomputed after trimming.
  Where: `scripts/bake-turnarounds.mjs`.
- **Overpass is flaky.** Bake OSM per route from a local dump (`bake-osm.mjs --from=`). Never fetch at runtime.
- **Dark smears on slopes in drone views (Formentor).** Shadows are baked into the PNOA orthophotos. De-lighting
  dark photo pixels helps only partly; the real fix needs another imagery source or a ground shader that ignores
  the photo on steep shaded faces.
- **The route started on a side street.** BRouter snapped the Gaisberg start to a service road beside the B158, so a
  lead-in along the B158 never reached `coords[0]`. Fix: the lead-in joins at the first route point on the same road
  and replaces the route before it (`leadIn.join`). Where: `scripts/bake-leadin.py`, `src/geo/leadIn.ts`.
- **BRouter cuts switchbacks.** On the B158 at Obergnigl it took a side street and a cycle path. Fix: follow the OSM
  ways of one `ref` with a shortest path instead. Where: `scripts/bake-leadin.py`.
- **Commons titles lie.** "meadow-kuehberg-autumn-01" is a trail signpost. Check reference photos by eye before
  they go on a board or into a brief.
- **Formentor climbed 87 m into its tunnel and dropped 56 m out of it (±25 %).** In the cut leading to a portal the
  DEM is still the hillside above the road, and the tunnel straightening started at the portal. Fix: across every
  tunnel the profile takes its lower hull from 150 m before to 150 m after; `cuts` spans do the same where a cutting
  fakes a ramp (Sa Calobra's 21 % at 2.7 km, now 9 %). Not a global gradient cap: the Kitzbüheler Horn really has
  22 %. Find them with a scan for runs over 12 %. Where: `route.ts` `lowerHull`.
- **One OSM building was three storeys too tall.** OSM had no levels for the bar at the knot. Fix: per-route tag
  fixes in `scenes/<id>.json` `osmTags` (`{ "<element id>": { "building:levels": "1" } }`). Where: `Engine.loadWorld`.
- **Five routes still had their first OSM bake** (no meadows, barriers, power lines, benches, bus stops,
  crosses). Re-bake every preset after `bake-osm.mjs` learns a new feature; compare tag counts with Gaisberg's file.

## Capture and review

- **A screenshot with pending tiles shows blurry or low-detail terrain** that looks like a bug. Re-shoot after
  `pending` reaches 0 (`engine.stats`).
- **HMR reloaded the page mid-flyover.** Don't edit `src/` while `flyover.mjs` or `shots-set.mjs` runs.
- **Large videos can't be sent to the phone (30 MB limit).** Re-encode at crf 28, 1280 px.
- **Shots were taken 70 m past their spot.** The simulator rode on (or rolled downhill) during the capture wait, so
  "9495" showed the loop behind the knot and "13500" the road after the tunnel; the reviewer then reported the arch
  and the tunnel missing. Fix: `shots-set.mjs` pauses the ride once loaded. Where: `scripts/shots-set.mjs`.
- **Check a reviewer blocker against the frame before fixing it.** Three of the first Mallorca blockers were the
  capture or the reviewer opening the wrong file, not the scene.
- **Shots changed when the Mac went on battery.** The app's battery saver drops to 30 fps and Balanced, so frames
  stop being comparable. Capture scripts now report a charging battery (`navigator.getBattery`). A zsh loop
  also ate `:c` in `"$1:chase"` (a path modifier): write `"${1}:chase"`.
- **The reviewer reported "no shadow" from arches that do cast one.** At golden hour the shadow falls long and away
  from the object, and the Haiku reviewer looked for it at the feet. Check with an A/B: the same frame with the
  object hidden (`engine.world.marks.visible = false`) and an image difference; the band across the road vanished.
  Sun shadows also only render within about 32 m of the rider, so far objects never show one.
- **Same colour on a pennant and its arch hides the pennant.** The flamme rouge's red triangle on a red arch read as
  a notch; on navy it reads. Where: `SegmentMarks.ts` `skinCanvas`.

## Devices and riding

- **Closing the app tabs dropped Chris's ride.** The tabs were closed to protect his wife's KICKR. Never close,
  reload or restart anything at :5199 without asking.
- **A dead battery lost a whole Gaisberg ride.** The Mac hibernated at 2 %, woke on the charger with the tab intact,
  and then Vite's client ("server connection lost. Polling for restart…") reloaded the page: the ride only lived in
  memory until "End ride". Fix: the ride is kept in IndexedDB every 5 s and on pagehide; Home offers Carry on / Save
  ride / Discard; a ride asks before the page unloads; a screen wake lock keeps the display on. Where:
  `src/sim/unfinished.ts`, `RideSession.snapshot/resume`, `App.tsx`.
- **The battery drained 50 % an hour.** The GPU was flat out the whole ride: at 1× on the forest climbs the scene
  made 45–57 fps on an M5 Max, so a 60 fps cap changed nothing there. The real cause was the logarithmic depth buffer
  (see Rendering). Fix: reversed depth, plus a battery saver when unplugged: 30 fps, Beautiful drops to Balanced
  (GPU busy 42 % → 36 % at 30 fps; Fast without MSAA only 2 points less and loses the soft tree edges). Measure with
  `ioreg -r -c IOAccelerator` "Device Utilization %" in a visible window; busy % is relative to the GPU clock, so
  compare frame rate and render scale too. `SystemLoad` in AppleSmartBattery updates only every few minutes.
  Where: `Engine.setBatterySaver`, `Engine.loop`.
- **Opening the app could take over someone else's trainer.** `reconnectKnown` silently reconnected the last
  trainer. Fix: rider profiles each keep their own saved devices; "Who's riding?" comes before any reconnect; a
  toggle for reconnecting saved devices; `?nobt=1`.
- **The saved devices didn't come back in the Mac app (2026-10-26).** Three causes. The Mac app looked for each
  saved device for 12 s once, when it opened, and a sleeping trainer or Zwift Ride was missed for good. The KICKR
  had been picked from the power-meter row too, so it was saved as trainer and power meter; on the next start the
  second reconnect turned the trainer link into a power meter (no resistance control; the 1.0.2 hub ends with the
  KICKR stuck on "reconnecting"). And the chooser tagged every device any rider had used, so the household's two
  KICKR CORE and two "Zwift Ride" entries all said "Last used". Fix: the app keeps looking for missing saved
  devices for 10 minutes (the rider opening the chooser stops a search under way first); one device has one role
  (a trainer stays the trainer, `src/devices/saved.ts`); the chooser tags only the active rider's devices; device
  events (connected, lost, back after n s, disconnected by the rider) go to `main.log`. The renderer's console isn't
  logged anywhere, so before this an in-ride drop left no trace in the app's own log. Where: `src/devices/index.ts`
  `search`, `register`, `electron/bluetooth.ts`, `electron/preload.ts`, `scripts/test-hub.ts` (fake devices).
- **A slight rise in the road needed far more watts.** At 100 % difficulty the physics is right, but a trainer
  flywheel carries far less momentum than 85 kg of rider and bike. Fix: gradient increases ease in (tau 4 s); new
  riders start at 50 %. Where: `session.ts`, `profiles.ts`.
- **An easy lead-in on a real 6–7 % road.** No flat road leads to the Gaisberg; Gnigl to Guggenthal climbs 150 m.
  Fix: in the lead-in the felt gradient (trainer, speed and pacers) is a third of the real one, at most 2 %, blending
  into the real one over the last 200 m; the climb segment gets its own id so old times stay honest. Ghosts and
  "your best" compare only rides with the same lead-in setting. Where: `session.ts` `feltGrade`, `segments.ts`.
- **Number fields jumped to 500 W, 150 kg or 20 kg.** Clamping on every keystroke. Fix: `NumberInput` applies
  in-range values live and clamps on blur. Where: `src/ui/home/shared.tsx`.
- **The HUD couldn't be read from the saddle.** The laptop stands about 2 m away; labels were 13–16 px and most
  numbers 38 px, and stats sat in mixed rows (heart rate next to kJ). 1 arcminute at 2 m is about 2.9 CSS px on a
  16" MacBook, so shrinking a screenshot by 2.9 shows what 20/20 vision resolves there (`scripts/hud-shots.mjs`).
  Fix: sizes in one unit that scales with screen height (`--u`, 1 px at 1117 px tall), values 62–172 and labels
  24 at that height, three groups (effort top left, climb top right, ride totals at the bottom) on translucent
  panels so labels hold against a bright sky; the big gradient sign gave way to a gradient figure with a colour
  underline, and VAM (30 s) joined the climb group. Where: `Hud.tsx`, `.hud` rules in `styles.css`, `session.ts`.
