# Roadmap

From the audit of 2026-10-24 (after the Mac app's 1.0.1): what to fix and build next, in order. Parked ideas
with no order yet live in [BACKLOG.md](BACKLOG.md).

## 1.0.2: safe to share

- [x] The Mac app's preload (and its bridge, settings mirror and Bluetooth) works only on Serpentine's own page,
  not on the Strava, Google or Apple sign-in pages shown in the same window. Those used to get the riders'
  names, weights and FTPs copied into their storage.
- [x] The local API refuses changes from other websites (a plain cross-site POST could replace the Strava app
  and drop every rider's tokens), and its errors no longer show paths or parser details.
- [x] A ride whose save fails at the end shows its summary with **Save again**; the copy kept every 5 s stays.
- [x] Trainer commands that fail or hang (3 s) are sent again on the next tick instead of being lost.
- [x] Battery warning that can't be missed: at 20 % or less, unplugged, a large warning at the top of the screen
  shows the minutes left and stays when the HUD is hidden. A chime sounds at 20, 10 and 5 %, and the start bar
  warns before the ride.
- [x] Help ▸ Copy Diagnostics and Show Log in Finder, for friends who need help.
- [x] Gaisberg comes first and is tagged "Most detailed", so a new rider starts on the best route instead of
  the 26 km Großglockner.
- [x] `npm test` (unit tests and the local API), `npm run check`, CI on every push, and the release script
  runs the checks too.
- [x] Small hardening: `.zwo` repeat counts capped, broken GPX points dropped; README fixes; two unused rock
  models removed (4 MB).

## 1.1: rides you can trust

- [x] A trainer drop-out mid-ride: the last watts carry a gap of up to 3 s; longer, the ride pauses itself with
  "KICKR … lost, reconnecting for n s" and carries on when power is back, so the gap is not ridden at 0 W into
  NP, TSS and the average (`session.ts` `watchDropout`, the HUD's drop-out overlay; tests in `test-session.ts`).
- [x] Ride time from the clock, not from drawn frames: below 10 fps the ride ran in slow motion (`Engine.ts`
  clamped a frame to 0.1 s), and a hidden Chrome tab stopped it. Needed for multiplayer and the island, too.
- [x] Free everything a ride built when it ends: props, life, tunnels, landmarks, textures and pacer name tags
  were left in GPU memory (`Engine.unloadWorld`). Now flat over rides (`scripts/probe-memory.mjs`).
- Tests for the ride session (started: the clock and the trainer gradient in `scripts/test-session.ts`), the
  unfinished-ride copy, storage and the device hub (fake devices).

## Ideas from Zwift Plus (DC Rainmaker's review, 2026-10-29)

Zwift Plus ($29.99 a month) adds Coach (adaptive plans) and Video Routes (filmed roads with Zwift's arches and
riders on top). What fits Serpentine, best first:

- [x] **A plan that adapts.** Coach moves and lightens sessions after missed days or an unplanned hard ride, plans
  towards a race date, and picks which ride covers a session; its workouts are written by people, so rules do the
  same here (`src/training/adapt.ts`): a missed hard session moves to a free day this week, never next to another
  hard one; after an unplanned hard ride (TSS 80+) or with form below −25 the next hard session goes easy; fitness,
  fatigue and form from every ride's TSS; a plan can end in an event's week. Today's session suggests the route that
  lasts as long (two, queued, when one is too short: `routeFit.ts`), and the summary has one line on the intervals
  (`feedback.ts`).
- [x] **Route queue.** The reviewer's main wish: at the top (or the end of a lap) the next route starts by itself
  instead of a menu (15 s to say "stay here"); a running workout carries on. Each route stays its own ride in
  History and on Strava (`src/sim/queue.ts`, the + beside each route).
- [x] **Segment arches and road paint.** Start and finish arches, painted lines and the word in the lane, a
  chequered finish, the flamme rouge and countdown boards before the top (`src/engine/SegmentMarks.ts`, brief
  `docs/art/segment-marks.md`; four review rounds, 3.00, not approved yet: open points in the brief).
- **Better route cards:** Zwift's are a profile and one sentence, and too thin. Ours can say length, metres,
  the famous section and why it is worth riding, from `research/<route>/`.
- **Own video routes:** Zwift films one take per road (two GoPro Hero 13 at 4K/120 on a car at cycling speed on
  climbs, a Karoo for GPS and barometric height) and plays it at the rider's speed. Serpentine could play an MP4
  the same way, gradient from the DEM; a GoPro with GPS writes the track into the file. Spike: one Gaisberg take.
- For 1.3: in a group a camera at head height mostly shows backsides (keep the chase camera above the riders);
  riders far ahead shrink and fade; steering around riders must be smooth; oncoming cars never hit you.

## 1.2: Strava for everyone

Rides go to Strava by themselves at the end, and friends can connect without creating their own Strava API
app. Decide first: one Serpentine Strava app with a tiny token service holding its secret (Strava caps new apps
at a single athlete until it approves more), or keep "bring your own app" for segments and add upload only.

## 1.1: ride with friends

- [x] **Group rides** (2026-11-21): a room per five-letter code on a Cloudflare relay (`relay/`, one Durable Object
  per room), the leader's route for everyone, a waiting room and one countdown, late riders start next to the
  group, kits, name tags with W/kg, gaps, minimap dots and drafting. Details and how to run the relay:
  [multiplayer.md](multiplayer.md). Brought forward from 1.3 on Chris's "I need a multiplayer mode asap", with
  1.1's clock fix (from the island branch) in the same release.
- [x] Keep everyone together, invite links that open the app, ready marks, ride-ons, races with live places and a
  finish, and everyone's results on the summary (Chris: "yeah go on, next 5", the same day).
- Next: group workouts, quick messages, following a friend with the camera, ride files as ghosts.

## One world: Serpentine Island

The full plan, with the map: [world/README.md](world/README.md). All routes on one invented island, joined by new
roads, like Los Santos in GTA or Zwift's Watopia: ride anywhere, take any turn, and still ride the famous climbs as
named routes. Each route keeps its real road, heights, photos, buildings and trees; the land and roads between are
made up to fit. Real heights stay real, so the island is high in the middle (the Alps) and low at the coasts
(Mallorca, Sydney); 254 km of real road and about 150 km of new road.

- **A road graph instead of one polyline**, with junctions picked by the Zwift Ride's D-pad or the arrow keys.
- **A land builder:** real ground within about 1.5 km of each road, a soft seam, invented land filled in from the
  edges; terrain, OSM, trees and roadside streamed in chunks ahead of the rider and freed behind.
- **Segments, ghosts, records and the FIT track** move from distances along one route to positions on the graph;
  rides on the island get ocean coordinates and show on Strava as a Virtual Ride. Today's routes stay as they are.
- **Order:** a spike (Gaisberg and Wolfgangsee joined by the 5.5 km Strobl road), the hard Mallorca-to-Alps seam,
  then the High Alps as the first world you can ride, then the other regions, the City last.
- **Later:** famous places with room on the map, Galibier, the Flanders and Roubaix cobbles, the Sella Ronda, the
  fjord roads and the Champs-Élysées first.

Effort: a few months, after 1.1's clock and memory work. It also makes multiplayer better: everyone in one world
instead of on one road.

## Art: every route to APPROVE

No route has passed the art review yet (`docs/art/scorecard.md`). The loop is brief → build → capture → review, as
in CLAUDE.md. What Chris cares about (2026-11-21): the surroundings — trees, buildings, the feel of the real place.
Not road cracks or asphalt detail.

### Where we left off (2026-11-21)

Released in 1.1.1: Central Park, the Vienna Ring and Sydney each got their own look (they had been drawn with
the Alpine one). On `main` since, not yet released (the next release is 1.1.2): near-camera ground on the city
routes, more building relief, varied people and traffic, Gaisberg on 1 m lidar terrain with vegetated cut banks.

Last independent scores (Haiku reviewer, no photo boards, so provisional; taken before the people round and the
Gaisberg work): Central Park 3.25, Vienna Ring 3.13, Sydney 3.38. Gaisberg has no score since the lidar.
Reviews are in `research/<route>/review-*.md`; before/after sheets are in `~/Desktop/Serpentine Routes/`.

How the work was done: one agent per topic (Sonnet for code, Haiku for look-only reviews and data hunts), each in
its own git worktree with its own Vite port and its own files, merged into one branch and checked with
same-settings stills. See the entries from 2026-11-21 in `docs/lessons.md`.

### Next, in this order

1. **Fix before releasing 1.1.2.**
   - Vienna's tram is a red box whose windows break into a comb pattern where it bends (`Tram.ts`). It needs a real
     model (bogies, doors, a pantograph, the wire).
   - A runner on the lawn at Sydney km 11.0 is drawn far too big next to the rider (`People.ts` scale or a figure
     standing closer to the camera than it looks; check).
   - The yellow post van in Vienna: colour fixed but never seen in a still. `tinted()` in `Life.ts` converts
     colours to linear twice; fix that properly rather than writing paler hex values.
   - Then a reviewer round on all four routes and a ride in motion: nothing from the people round or Gaisberg has
     been watched moving.
2. **Photo boards.** No city route has a reference board, so every score is provisional and the reviewer misreads
   things. Chris's own photos or licensed ones; nothing scraped.
3. **Lidar for the other Austrian routes.** The BEV 1 m ground model covers all of Austria (CC BY 4.0). The pipeline
   is `scripts/bake-dem.py --corridor` on a windowed read of
   `https://data.bev.gv.at/download/ALS/DTM/20250915/ALS_DTM_CRS3035RES50000mN{N}E{E}.tif`: Kitzbüheler Horn,
   Großglockner, Wolfgangsee, Wachau, Neusiedler See. Chris has not picked the order. Spain (CNIG MDT02), France
   (RGE ALTI) and South Tyrol have their own lidar; licences not checked yet.
4. **Gaisberg, what is still wrong.** No real ditch at the foot of the banks (needs geometry or a distance field,
   the verge mask is 4.5 m wide); shaded drop-off sides are flat teal-grey; saplings read as blobs; no retaining
   walls or wire mesh on fresh cuts; a 0.3–1.3 m step where lidar meets the global terrain (hidden by skirts);
   `prefetch.ts` does not fetch the fine tiles for offline use.
5. **Central Park.** The skyline is still a grey-blue band where the slim 57th Street towers cannot be picked out;
   apartment-house detail does not read from 200 m; the twin-towered houses are placed by size, not at the real
   San Remo, Eldorado, Majestic and Century; tree crowns repeat one rounded shape from above; bare earth under
   trees reads as brown discs; no Bethesda Terrace, Bow Bridge or arches; a chicane is left at km 8.3.
6. **Vienna Ring.** Big roofs (University, museums) are bare planes; cornices read as loose slabs from very close;
   mottled dark blotches on lawns and paving; traffic is two-way on a one-way carriageway; no dedicated models
   for Rathaus, Parliament, Votivkirche, Opera; courtyards are filled in; avenue rows have gaps.
7. **Sydney.** Suburbs are lawn everywhere outside roads and paths (no driveways, fences, gardens); one oversized
   house and one windowless slab; fig trunks too thin; Bondi Pavilion's roof is plain slabs; no Icebergs pool in
   view, Bronte baths or Coogee jetty; Norfolk pines are placed by rule, not surveyed; the sun path for the
   southern hemisphere was never checked.
8. **Spurs in the other loops.** `node scripts/bake-routes.mjs --despur` lists dead-end spurs in Vienna Ring,
   Sydney, Wachau, Neusiedler See and Wolfgangsee (the rider turns on the spot). Only Central Park was cleaned,
   because cleaning shortens a route and shifts best times. Chris has not decided.
9. **The other mountain routes** (the first idea list of 2026-11-21, still open): scanned ground within 60 m of
   the camera instead of the aerial photo, a real road edge (shoulder, crumbling edge, grass creeping in), dense
   short grass and flowers near the camera with wind, hero trees, better skies and softer near shadows per time
   preset, hand-built landmarks where reviews keep rejecting generic blocks (Stelvio's pass hotels, Kitzbühel).
   The vegetated cut banks already apply to every Alpine route; only Kitzbüheler Horn was looked at afterwards.

## Later

- Weather and time of day, in the order of [BACKLOG.md](BACKLOG.md): live weather and the real sun first.
- Intel Macs (an x64 or universal build), if a friend needs one.
- Import `.fit` rides from Zwift or Garmin into History, and export drawn routes as `.gpx`.
