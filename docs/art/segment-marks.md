# Segment marks: art brief

Not a place but race-day furniture that goes on every route: what marks a timed segment (`src/sim/segments.ts`)
in the world, built in `src/engine/SegmentMarks.ts`. Idea from Zwift's video routes (arches, banners and road
paint on filmed roads, DC Rainmaker's review 2026-10-29), but the look comes from real road races: the inflatable
arches of gran fondos and the Tour's mountain finishes, painted start lines, the flamme rouge.

**Mood:** a hill-climb race morning on an open road. The marks are added to the place, so they must sit in it
(scale, ground contact, light, shadow) and never hide what the route is about.

**Hero categories:** road and roadside, sense of place, light and atmosphere.

## What is placed

| Mark | Where | What has to be right |
|---|---|---|
| Inflatable arch, banner "<segment name> · START" | start of the full climb, the steepest km, sprints, hills and the Strava segment the pacers race | spans the road, legs on the verges, feet in a low dark ballast plate on the ground, about 5.5 m high: a rider and a car fit under it |
| Painted start line + the word KOM or SPRINT | line across the road at the start; the word 1.5 to 8.5 m before it, in the rider's (right) lane | white, worn, the word stretched along the road so it reads from the saddle, clear of the centre line |
| Inflatable arch, banner "KOM · FINISH" (or SPRINT) | segment end; on a climb the summit | same arch as the start; the timing line is the end, so at a summit it can stand where the road meets the car park |
| Chequered line | segment end | two rows of 0.8 m squares across the asphalt only, legible from 20 m |
| Flamme rouge | 1 km before the end of a climb segment of 1.8 km or more | navy arch (#1f3f73, lighter than the banner ink, which read as black on a tube) with a large red triangle hanging from the middle, its tip well above a rider (a red arch hid it) |
| Countdown boards "500 m", "200 m" | right verge before the end of those climbs | white with a red border, on two posts, like the km signs: never on the road |
| Strava segments (others) | start and end | thin white lines only (dashed at the start): a famous climb holds a dozen segments |

## Look targets

**Colours.** KOM: the climber's jersey, white with red dots (#f4f3ee, #d7322b). Sprint: green (#1f9d55) with a
white band. Banner: navy (#0d1b24, Serpentine's ink) with white Barlow Condensed, the pattern block on the left.

**Material.** Nylon: matte to satin, never glossy or glowing; seams once a metre; shaded and shadow-casting like
everything else (`patchMaterial`). Sun shadows render within about 32 m of the rider for every object, so an arch
further ahead has none yet.

**Paint.** Road paint white like the edge lines, worn, never brighter than them; lies on the asphalt (no
z-fighting, no floating), stays inside the edge lines.

**Never.** Neon colours, emissive or glowing arches, floating text, marks in tunnels, two arches within 40 m.

## References

- Tour de France mountain finish: polka-dot KOM banner, flamme rouge 1 km out, countdown boards (photos: not
  committed).
- Gran fondo and hill-climb inflatable arches: legs on the verges, ballast at the feet.

## Feedback log

| Date | From | What | Why |
|---|---|---|---|

## Status

2026-10-29: built; four review rounds (`research/gaisberg/review-2026-10-29-segment-marks.md`), mean 2.67 → 3.00,
no blockers, still REJECT. Open: the summit arch's left leg stands on the wide summit junction (the route has no
road width there), the board's second post at distance, the ballast plate a little thick, the K close to the centre
line. The reviewer's shadow finding was checked by A/B and is wrong (lessons.md).
