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

- **Every ride left GPU memory behind** (textures 51 → 76 → 87 → 103 and geometries 93 → 171 after four rides).
  `unloadWorld` freed geometry and materials of a few groups but no textures (signs, chevrons, asphalt loaded per
  ride), no instance buffers, nothing under props, life, tunnels and landmarks, not the tree impostor atlas, and only
  the texture of the sky's reflection map (PMREM), not its render target. Fix: `disposeObject` frees geometry,
  materials, their textures (a render target through `texture.userData.renderTarget`) and instance buffers;
  session caches (GLB models, foliage atlas, ground, asphalt and wall textures, shared materials) are marked with
  `markShared` and survive; ride groups are `WorldGroup`s, so a build that finishes after the ride ended frees what it
  adds. Now flat: 90 geometries and 52 textures after every ride. Check with `scripts/probe-memory.mjs`; to find a
  leak, wrap `gl.createTexture`/`deleteTexture` and record stacks. Where: `src/engine/dispose.ts`,
  `Engine.unloadWorld`, `Engine.updateEnvironment`.

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
- **A friend 8 m ahead showed 4 m ahead, and they saw us 12 m behind.** Each rider's position was eased towards
  where they were (tau 0.5 s), which trails a moving target by speed × tau. Fix: draw them where dead reckoning puts
  them now (last position + speed × (time since + half a round trip)) and ease only the correction a new position
  makes. `scripts/e2e-group.mjs` checks both views against the real gap. Where: `src/net/group.ts` `reckon`, `tick`.
- **A trainer that dropped mid-ride counted as minutes at 0 W.** The hub clears a lost device's values (and calls any
  value older than 3 s gone), so the session read `power ?? 0`: the rider coasted to a stop and the zeros went into
  NP, TSS and the average. Fix: missing power after power was seen is a drop-out; up to 3 s the last watts carry on,
  then the ride pauses itself (the trainer told to let go) with an overlay naming the device the hub is getting back,
  and rides on when data returns ("Power is back after n s"). A ride that never had power (keyboard, no trainer) is not
  a drop-out. Where: `session.ts` `watchDropout`, `Hud.tsx`, `scripts/test-session.ts`.
- **Keep-together held 300 W and 180 W 24 m apart, out of the draft.** A pull of 0.12 m/s per metre beyond 3 m
  balances a 1.9 m/s speed difference only far apart (2 × (3 + 1.9 / 0.24) m). Fix: 0.6 m/s per metre beyond 1.5 m
  (about 6 m apart, closing in about 1.7 s, still slow against positions half a second old). Where: `session.ts`
  `groupPull`, `scripts/test-session.ts`.
- **The summary of a group ride showed no results.** `end()` set the summary's group while the screen was still
  "ride", so the effect that leaves the group once the summary is gone left it at once. Fix: set the group in the same
  render as the summary screen. Where: `App.tsx` `end`.
- **Below 10 fps the ride ran in slow motion, and a hidden tab stopped it.** Drawn frames drove the ride and a frame
  counted 0.1 s at most. Fix: the ride runs on the wall clock in steps of at most 50 ms, from the render loop and
  from a 250 ms timer while frames don't come; a gap of more than 65 s (a Mac that slept) counts as 65 s. Capture
  scripts that step a paused engine with `engine.frame(dt)` still get exactly dt. Where: `src/sim/clock.ts`,
  `App.tsx` (`SimClock`, the fallback timer), `Engine.frame(dt)` hands `live` to the frame callback;
  `scripts/test-session.ts`.

- **Manhattan was built from Austrian farmhouses.** A route outside the Mediterranean box got the Alpine biome, so
  Central Park's skyline was white plaster blocks with red hip roofs, cut off at 80 m, plus spruces, cows, cars,
  delineator-road markings and highway lamps. Fix: a `manhattan` building style (flat roofs, parapets, masonry and
  curtain-wall facades, water tanks), heights up to 600 m, and OSM `building:part` geometry (own height and
  `min_height`, colour, material) with the plain outline dropped where parts exist; the scene file turns on
  `carFree`, `parkLamps` and `lawn`. Where: `Buildings.ts` `addCityBlock`, `osm.ts` `dropOutlines`,
  `scenes/central-park.json`, `Life.ts` `buildPark`, `Road.ts` `parkLamps`.
- **Facade bays stretched on Manhattan's grid.** The facade shader measured along a world axis; walls turned 29° off
  north got bays 14 % too wide and different on the two street directions. Fix (city surfaces): measure along the
  wall from its normal. Windows smaller than a pixel are faded to the mean of wall and glass with `fwidth`.
  Where: `Buildings.ts` `facadeMaterial`, surfaces 9 and 10.
- **`bake-trees.py --fill` planted 123,000 trees in Central Park.** Fill is for closed forest; in a park the canopy
  peaks alone (13,952 with `--window 0.8`) match the real count. Park trees also need the open-grown model for every
  tree, or tall trunks carry small crowns. Where: `bake-trees.py`, `Vegetation.ts` (`biome.lawn`).
- **Central Park's rider turned on the spot and rode back, twice near the end.** Via points a few metres off the
  drive made BRouter ride out to them and straight back: five dead-end spurs (0.2 to 19 m, at 1.16, 2.85, 8.4, 9.24
  and 9.46 km), and the start itself was a 5 m spur. Fix: `despur` cuts a detour wherever the line returns to a point
  it left less than 120 m of riding ago, and closes a loop where the start spur left the road; it runs in every bake
  and on baked files with `--despur`. Wachau, Neusiedler See, Wolfgangsee, Sydney and Vienna Ring have spurs too
  (listed by `node scripts/bake-routes.mjs --despur`, not yet applied: lengths and best times shift).
  Where: `scripts/bake-routes.mjs`.
- **A thin pale needle stood in the sky over Central Park.** Not a mast: the elevation tiles carry junk over the
  Hudson (pixels at -31,000 m and +6,600 m), and the terrain drew them. Hiding buildings, trees, props and life one
  by one left it; hiding the terrain removed it. Fix: every DEM tile is cleaned on load: impossible heights and pixels
  further from their neighbours than a cliff allows (150 m, or four pixels' width at coarse zooms) are filled from
  the ground around them. Where: `src/geo/elevation.ts` `sanitize`.
- **Three agents built one route in parallel without stepping on each other.** Each got its own git worktree and Vite
  port (edits hot-reload a capture otherwise) and its own files: `Buildings.ts`; `treeModels.ts`/`Vegetation.ts`;
  `Life.ts`/`Props.ts`. The three branches merged without a conflict. New park-only behaviour hangs on biome switches
  (`carFree`, `lawn`, `parkTrees`), checked with a same-settings Gaisberg still on main and on the branch.

- **Sydney was Salzburg by the sea.** The route fell into the Alpine biome: Norway spruces, beeches in autumn colour,
  plaster farmhouses with shutters, meadow tufts, cattle and delineator posts, and right-hand traffic. Fix: a `sydney`
  biome (Alpine base, Mediterranean foliage atlas) with `sydneyTrees`, `suburb` and `leftHand` switches. The four tree
  slots carry Norfolk pine, fig, eucalypt and a street tree, chosen by place (distance to the sea from the ground
  height, OSM parks); buildings get a `sydney` style (brick bungalows with terracotta hips and chimneys, walk-up flats,
  Art Deco render, shop awnings, muted glass towers through `addCityBlock`) on surface ids 14 to 16; OSM beaches, rock,
  cliffs and parks go into a surface mask (`uSurface`) that tints sand and sandstone and turns parks into lawn; Life
  skips cattle and keeps cars and cyclists left. Where: `biome.ts`, `sydneyTrees.ts`, `treeModels.ts`, `Vegetation.ts`,
  `Buildings.ts`, `terrainMaterial.ts`, `Engine.ts` `buildWaterMask`, `GroundCover.ts`, `Life.ts`, `osm.ts` `Shore`,
  `scenes/sydney.json`.
- **A tree model scaled by crown width grew a 4 m trunk.** Instances scale x and z by the crown diameter, so a fig
  (crown radius 16 m) turned a trunk radius of 0.05 into 1.7 m (4 m at the buttress). Fix: model trunk radii are in
  crown-width units (0.03 for a fig, 0.017 for a gum); check them against the widest crown the species can get.
  Where: `treeModels.ts` `figGeometry`.

- **The Ring was lined with Salzburg farmhouses, meadow tufts and highway lamps.** A city route got the Alpine biome,
  so Vienna's Ringstraße showed white plaster blocks with brown shutters and red roofs, long grass along the kerb,
  edge-line markings, regular highway lamps and (from the OSM data) wooden fences, firewood stacks and Alpine benches.
  Fix: a `vienna` building style (`ViennaBlock.ts`: five to six storeys with a stone cornice, hip, mansard, gable,
  dome, onion and spire roofs from `roof:shape`, `roof:height` and the part's colours, chimney stacks; monuments by
  name or tagged colour) and facade-shader surfaces 11 to 13 (rusticated ground floor with arches and portals,
  mezzanine, pediments over the piano-nobile windows, plain upper floors, tile courses and dormers on roofs). The scene
  file switches on biome fields `streets` (pavement beside the road, lawn only inside OSM `leisure=park|garden`, no
  tufts, cattle, firewood or Alpine fences, no road edge lines), `viennaLamps`, `avenueTrees` and `streetLife`.
  Where: `ViennaBlock.ts`, `Buildings.ts` (surfaces 11-13, `STYLES.vienna`), `terrainMaterial.ts` (`uStreet`),
  `GroundCover.ts`, `Props.ts` (`viennaLamps`), `Life.ts` (`buildStreet`), `scenes/vienna-ring.json`.
- **OSM roof shapes and parts were thrown away at parse time.** `parseOsm` turned every dome, onion and pyramidal part
  into one pyramid and every other part into a flat deck, and plain buildings lost `roof:height`. Fix: `Building`
  keeps `roofTag`, `roofMaterial`, `roofHeight` and whether the height was tagged; city styles read them. Also new:
  `OsmWorld.parks` (leisure parks and gardens) and `trams` (`railway=tram`). Where: `osm.ts`.
- **The baked Vienna file had no tram tracks.** The task notes said it did; `railway` was not in `KEEP_TAGS`, so the
  tag was stripped when the file was compacted. Fix: `railway` is kept now, and the surface tram tracks within 200 m of
  the route (163 ways) were fetched once from Overpass and appended to `public/osm/vienna-ring.json`. Trams run on
  the chained tracks (`Tram.ts`), cut wherever a track would enter the carriageway.
- **Pale teal ground and bleached squares on a city route.** The terrain shader calls any non-grey photo pixel grass,
  pulls the pavement's dark pixels to a "vegetation hue" and clamps bright pixels to meadow green: in Vienna the
  squares went white and the shadows on the Ring teal. Fix (`uStreet`): ground is warm grey stone with a lowered luma
  unless it is lawn (park mask in the G channel, or clearly green and not under a crown); no litter under trees, no
  verge grass at the road, half the gravel relief.
- **Shared code was left alone for the next style to build on.** New style code lives in `ViennaBlock.ts` and `Tram.ts`;
  `Buildings.ts` only gained exports, a `Style.vienna` flag and one shader branch, with surface ids 11-13 (Sydney: 14-16).
- **A copper roof stayed mint after being "greyed".** Mixing the tagged colour (#6EBE9F) towards grey and capping
  its HSL saturation at 0.14 changed nothing on screen: in linear light green was still twice the red, and under the
  noon sun that reads as teal. Fix: tagged copper-green roofs get the weathered tone outright (linear 0.15, 0.19, 0.17).
  Judge a colour fix by the re-captured frame, not by the number. Where: `ViennaBlock.ts`.

- **The city ground was a photo: blurry, blotchy, smeared, with no kerb.** The aerial photo carried every pixel within
  2 to 30 m of the saddle, so lawns were airbrushed green with speckle, Vienna's roadside a grey-green plane, Sydney's
  slopes streaks of roofs and tarmac, and the asphalt edge fell off into the verge. Fix: a city branch in the terrain
  shader (`uCity`, kinds park, street, suburb) that builds the surface from OSM masks and procedure up to ~200 m and
  fades to the photo only beyond ~900 m: turf (a new fine-grain `lawn` texture at two scales, soft mottling, dry
  patches), bare earth and leaf litter under the baked crowns, slab pavement with joints that fade with `fwidth`,
  asphalt where the OSM carriageways (surface mask B) or Vienna's dark photo say so, a pale edge stone along a park's
  border, beach sand with a wet band by height, sandstone beds with bedding lines. The lawn takes the photo's
  brightness (clamped 0.9 to 1.12) so the hand-over shows no ring. The road gets a real cross-section in city biomes:
  gutter and raised kerb stone (park drives, suburbs), or a flush granite edge row, 3 m of slab pavement and a kerb lip
  that drops to the street (Vienna). Mapped footways become thin ribbons draped on the terrain (pale asphalt in
  Central Park, gravel in Vienna's parks and slabs on its sidewalks, joined concrete in Sydney), because the 3 m land
  mask cannot hold a 2 m path. Where: `terrainMaterial.ts`, `groundTextures.ts` (`lawn`, `PAVING_GLSL`), `Road.ts`
  (`cityProfile`, `STREET_LEDGE`), `GroundCover.ts` (`pathMaterial`, `buildPaths`), `Engine.ts` (surface mask).
- **A grass texture's bump made turf sparkle.** The old detail texture also drove the normal (`tBump`), and a
  centimetre-scale height gradient is hundreds of times steeper than the pixel can resolve: the lawn "speckled" under
  the sun. Fix: fine turf grain only moves colour; the bump on a lawn is a 1 m mottle of 2 cm.
- **Mask edges at 3 m per texel need `fwidth` or they read as smears.** The land masks are bilinear at 3 m, so a
  `smoothstep(0.3, 0.8)` edge is 1.5 m of fade. For hard borders (park lawn, carriageway, sand, sandstone) use
  `smoothstep(0.5 - fw, 0.5 + fw)` with `fw = fwidth(mask) * 0.7 + 0.02`: crisp at any distance, 0.5 m of wobble.
- **Value noise on the world axes tiles into squares.** Leaf litter under baked crowns showed as brick-like squares from
  the drone. Turn the noise coordinates off the axes (a 37 degree rotation) and widen the crown edge with noise.
- **Tufts in a lawn looked stamped.** One atlas card at one proportion, tinted a little, repeated: the eye finds the
  copies at once. In lawn biomes the tufts are now 5 % of the old density, with independent width and height, a lean,
  a mirror flip, and a tone from dark green to bleached straw. `GroundCover.ts` `add`.
- **The "flat pale-grey band across the lanes" on Sydney at 2800 m is a gap between two building shadows, not ground.**
  With the sun's shadow map off the band is gone and the road is one grey; at golden hour it is gone too. A tall building
  to the south casts a long shadow over the lanes with a straight edge, and the sunlit gap between it and the next
  shadow reads as a pale flat plane. Separately, the coarse terrain mesh did poke through the asphalt at that crest
  (a ray hit terrain 3 to 5 m before the road), so city routes sink the drawn mesh 1.1 m under the road instead of
  0.45 m (`Terrain.roadSink`; `groundHeight` keeps 0.45 so placed objects do not move).
- **A route with traffic showed no cars.** Sydney's traffic spawned the first car 650 m ahead on a 6 to 20 s timer and
  oncoming cars close at 22 m/s, so a capture (which waits 24 s) or a ride's first half minute saw an empty road; the
  cars that were there had already passed. Also the rider's own lane was +1.7 m, right of the heading, in a country
  that drives left: the rider sat in the oncoming lane. Fix: `seedTraffic` puts cars on the road at load and after
  any jump along the route, a suburb spawns every 4 to 10 s, and `Engine.loadWorld` starts a left-hand rider at
  -1.7. Check traffic with a shot taken a few seconds after load as well as the usual 24 s wait. Where: `Life.ts`
  `seedTraffic`, `traffic`; `Engine.ts` `loadWorld`.
- **Pooled things must be re-placed in route distance, not in world space.** Parked cars, beachgoers, surfers and
  pavement walkers are small pools; each frame the ones more than ~90 m behind (or never placed) are handed a free
  spot 20 to 600 m ahead, found by bisecting a list of spots sorted by route distance. A teleport (a capture, a ride
  restart) then costs one frame. Spots are computed once: kerb spaces in front of houses (not at a side street, not on
  an embankment), sand within sight of the route. Where: `Life.ts` `sydneySpots`, `spotPlace`.
- **A rotation applied to world coordinates throws a grid kilometres off.** The cemetery's headstone grid was turned
  by rotating absolute world x, z (thousands of metres from the origin) and landed nowhere near the polygon. Rotate
  about the polygon's centre. Where: `Props.ts` `sydneyLandmarks`.
- **Guessing a landmark's coordinates from memory put headstones on a beach.** Waverley Cemetery is south of Bronte
  Beach, not between Tamarama and Bronte. Fix: place the landmark, shoot a drone frame, read where the aerial photo
  shows it, move it. Where: `Props.ts` `sydneyLandmarks`.
- **A gum is pale, open and drooping, not a dark round crown.** `treeModels.ts` `gumGeometry` builds three shapes: a
  tall gum (straight pale trunk forking high, sparse hanging leaf cards, crown wider at the top), an angophora
  (short salmon trunk, sinuous limbs, wide layered crown) and a coastal banksia (crooked dark trunk, dense dome).
  Bark colours are in the model (instance tints only colour the leaves), so tone differs between shapes through
  separate geometries and between trees through palettes (`season.ts` `sydneyTint`). Sydney needs six instanced
  kinds, so `Vegetation.ts` has `extraA` and `extraB` beside the four shared ones; the impostor atlas is six cells
  wide only for Sydney, other biomes build exactly what they did.
- **One OSM outline can be a whole terrace.** A 25 m x 12 m footprint tagged `house` became a single hip roof the size
  of a church. Rectangular footprints are now split into 6 to 7 m units, each with a roof colour of its own (terracotta,
  slate, Colorbond), a brick fin and a chimney on every party wall, and a verandah and front wall on the side nearer the
  route; footprints more than 10 m deep and over 230 m2 are walk-up flats. Painted units use pale colours only: a navy
  wall read as a hoarding. Where: `Buildings.ts` `sydneyHouses`, `addSydneyBuilding`.
- **Firewood stacks stood in front of Sydney houses.** `Props.build` put one beside 32 % of `house` footprints unless
  the biome was `streets`; `suburb` now skips them too. Where: `Props.ts`.

- **City buildings were window grids: the detail was shader-only and vanished at 50 to 400 m.** Reviewers scored "built
  environment" 3 of 5 (Central Park) and 2 of 5 (Vienna): no cornice, base, tank or crown from a distance. A window
  pattern is under a pixel at 300 m; what reads is silhouette and relief that catches light. Fix: real geometry for the
  big moves, through the merged `Builder` buffers. Manhattan (`addManhattanBlock`): a different stone at the base
  under a projecting belt course (the shader reads the base height from the new per-vertex `aux`, so colour and
  grooves match the geometry), corner piers and shallow bays, a cornice scaled by height (up to 1 m proud with a
  fillet), setback terraces with parapets on tall plain blocks, copper mansards with dormers, stone setback towers
  ending in a lantern and a pyramid, twin crown towers on big pre-war houses, bigger bulkheads and tanks. Vienna: a
  rusticated base and mezzanine in a greyer stone with mouldings at the joints and a balcony band, centre risalits and
  corner bays, a 1.9x cornice, dormers as geometry on mansards and hips, corner turrets with small domes, bigger
  chimneys, a balustrade with statues and a pediment on monuments, skylights and a crest on big decks. Where:
  `Buildings.ts` (`addManhattanBlock`, `roofEquipment`, `crown`, `twinTowers`, `cornice` scale, `Builder.aux`),
  `ViennaBlock.ts` (`ledge`, `quoins`, `projection`, `dormers`, `balustrade`, `deckDetail`, `turret`).
- **Geometry and shader must agree on storey heights.** The shader drew its base, mezzanine and piano nobile from
  per-building hashes, so a base coloured in geometry would never line up. Fix: the JS side picks the heights and hands
  the top of the base (Manhattan) or of the mezzanine (Vienna) to the shader in `aux`; a negative `aux` marks an upper
  tier or a turret with no street floor. Anything that colours part of a wall in geometry needs the same trick.
- **A concave footprint hung a dark plate beside the roof.** `insetRing` mitred a roof's inset ring out of a concave
  corner and the flat deck was triangulated from it ("a dark pointed cap reads as a pyramid" in the Vienna review).
  Fix: an inset is refused unless every point lies inside the footprint and every edge still runs the way its wall does;
  the roof falls back to a flat deck. Where: `ViennaBlock.ts` `insetRing`.
- **A 100 m wide gabled roof was one tiled plane.** The University is tagged gabled with a 1 m rise: a ridge roof over
  50 m of half-width. Fix: above 900 m² a roof is a steep outer slope, a gentle second slope and a deck with skylight
  lanterns and a lead crest, whatever the tag says. Where: `ViennaBlock.ts` roof section, `deckDetail`.
- **Ledges round every edge of an outline cost more than the walls.** Chamfered and curved corners are runs of
  half-metre edges; a cornice (ten triangles) on each took Central Park's buildings from 1.4 M to 2.4 M triangles.
  Fix: no ledge on edges under 1.6 m, no fillet on houses under 30 m, belts and corner piers only on outlines with
  few edges, soffits dropped on belts, dormers capped per roof. Measure with `engine.world.buildings` (sum of mesh
  position counts / 3): Central Park 1.41 M to 1.71 M, Vienna 0.48 M to 0.76 M.
- **Parts of one tower must not get different characters.** A tower mapped as a stack of 3D parts is built part by part
  with a per-part seed. Fix: the character (pale concrete grid, dark glass, silvery glass, 1960s dark box) of a tagged
  glass tower comes from its tagged colour, which the parts share; untagged towers use a hash. Where: `Buildings.ts`
  `addManhattanBlock`, curtain-wall branch of the facade shader (`vAux` 1 to 4).
- **A custom camera is the way to look at a facade.** The `chase`, `side` and `drone` cams look along the road, so the
  buildings are a strip at the edge. `engine.cameraOverride` replaces the camera each frame: a capture script that sets
  it from route-relative offsets (along, right, up) reviews roof lines and skylines properly.

- **The same red pushchair was the nearest person in four of seven Central Park stills.** Everyone in the pool was put
  at a fixed distance ahead of the rider (`25 + r^1.8 * 665`) from a fixed random stream, so every start, whatever the
  position, dealt the same tableau. Worse, `Life.update` runs while the world is still being built: the first-frame
  placement ran on an empty pool and every group stayed at distance 0. Fix: a start or a jump (`jumped`, a move of
  more than 120 m between frames) reseeds the random stream from a hash of the rider's position (30 m buckets: a spot
  repeats, spots differ) and `deal()` shuffles the groups and spreads them evenly over the view ahead (denser near
  the rider). City routes hold the update (`pending`) until the crowd exists. The "red-and-white upright on the
  carriageway" in `r3-6400-drone-noon` was that pushchair and its parent in a red top, not scenery. Where: `Life.ts`
  `reseed`, `deal`, `jog`, `pending`.
- **Pedestrians on footways were spread over the whole route, not around the rider.** 46 walkers on a 9.8 km loop
  (90 on the Ring's 5.9 km) left "one to three people" in view. They are pooled now: a walker out of sight or new is put
  on a footway within 420 m of the rider (`relocate`). Where: `Life.ts`.
- **"One figure in 40 outfits."** The model is one mesh and the look pool only recoloured it. `PersonKit` now cuts
  `person-stand.glb` apart at the shoulders (body triangles with a vertex on the torso's 1.03 or 1.47 m rings are
  torso, the rest arm), elbows (1.17 m) and knees (0.49 m), and dresses it from 160 looks in four kinds (runner,
  park walker, city, beach): height and build factors, nine skin tones, hair colours, seven hair or hat shapes, sleeves
  cut with `splitY` (clean at any height, so shorts and short sleeves end in a line), shorts, tights, skirts, coats and
  dresses, shoes. Geometry is built once per look and shared. Runners have bent elbows and fold their knees (seven
  draw calls), walkers five, anyone standing or sitting is one baked mesh. Beyond 100 m a mover swaps to a one-piece
  stand-in (calls on Central Park fell from 2,500 to 1,900). Where: `People.ts`.
- **Groups chatting faced away from each other.** The park and street crowds turned each figure with
  `atan2(-cos a, -sin a)`; the figures face -Z, so the right turn towards the middle is `atan2(cos a, sin a)` (the
  Sydney code had it right). One `crowd()` helper now. Where: `Life.ts`.
- **Vienna had no cars.** The traffic pool was the mountain-road one: a car every 20 to 65 s from 650 m ahead.
  Vienna now builds its own set (nine hatchbacks in white, silver, black and grey, two cream taxis with roof signs,
  three vans with Austrian Post yellow, a red Wiener Linien bus, two scooters), seeds oncoming and receding traffic
  at load and after a jump (Sydney's `seedTraffic`, with a lane of 2.0 m for the 8.4 m carriageway), spawns a car
  every 2.5 to 6.5 s, parks 18 cars at kerb spaces where the ground is flat and clear of trunks (`osm.trees`), lamps,
  benches, tram track and side-street mouths, queues people on the mapped tram platforms (OSM `highway=platform`,
  turned to the nearest track) and rides cyclists along the mapped `highway=cycleway` lines. Where: `Life.ts`
  `buildStreet`, `streetSpots`, `tramStops`, `cycleTracks`, `pathRide`.
- **Kerb cars face the traffic of their side.** `kerb()` hard-coded left-hand traffic; it uses `keep` now, so Vienna's
  parked cars point the right way.
- **The "timber-rail fence" at Bondi was a row of benches.** OSM maps a bench node every few metres on the promenade
  (69 within 100 m of `r5-181`); `Props` placed them all, facing the road, and they read as a split-rail fence.
  Suburb routes keep one bench per 12 m. Where: `Props.ts` `build`.
- **Bondi Pavilion read as a motel.** It was a cream box with a flat dark strip where the arcade should be. It is now two
  storeys: a ground-floor arcade of white round arches (half discs over dark openings) under an entablature, windows in
  white frames above a string course, a taller centre block with pilasters, and hipped terracotta roofs that overhang
  the walls by two metres. Where: `Props.ts` `sydneyLandmarks`.
- **Central Park's boathouse, Dairy and sheds were flat grey boxes.** Low buildings (under 14 m) within 170 m of the drive
  are park buildings: schist or red brick on a darker plinth, a hipped slate or green roof with a 0.75 m overhang, a
  brick chimney, and a porch (platform, posts, lean-to roof) along a footprint longer than 11 m. The avenue blocks stand
  17 m and more, so the height test keeps them out. Where: `Buildings.ts` `lowParkBuilding`, `addParkBuilding`.
- **Bondi at 450 m showed nobody.** Sand was searched only 154 m either side of the route; the beach is 200 m away. 264 m
  now, and more lawn groups. Left-hand traffic is checked with a frozen frame: an oncoming car on the rider's right and
  an overtaking car passing on the right (`shots/sydney/r4-left-hand-chase.png`).
