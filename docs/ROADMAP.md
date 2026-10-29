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

- A trainer drop-out mid-ride: a banner on the HUD, and the gap kept out of NP/TSS instead of being counted
  as minutes at 0 W (`devices/index.ts` `onDisconnected`, `sim/session.ts`).
- Ride time from the clock, not from drawn frames: below 10 fps the ride runs in slow motion today
  (`Engine.ts` clamps a frame to 0.1 s), and a hidden Chrome tab stops it. Needed for multiplayer, too.
- Free everything a ride built when it ends: props, life, tunnels, landmarks, textures and pacer name tags
  are left in GPU memory today (`Engine.unloadWorld`). Check with `renderer.info.memory` over three rides.
- Tests for the ride session, the unfinished-ride copy, storage and the device hub (fake devices).

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

## 1.3: ride with friends

The multiplayer plan: friends' rides as ghosts (share a ride file, it rides with you), then live rooms (a small
relay, e.g. Cloudflare Durable Objects) with group rides and races. Needs 1.1's clock fix.

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

No route has passed the art review yet (`docs/art/scorecard.md`; best scores 3.13 for the Kitzbüheler Horn and
Großglockner after round 3). One route per round through the brief → capture → review loop in CLAUDE.md, the
famous climbs first: Alpe d'Huez, Ventoux, Stelvio, then Gaisberg again with the shared fixes since its review.

## Later

- Weather and time of day, in the order of [BACKLOG.md](BACKLOG.md): live weather and the real sun first.
- Intel Macs (an x64 or universal build), if a friend needs one.
- Import `.fit` rides from Zwift or Garmin into History, and export drawn routes as `.gpx`.
