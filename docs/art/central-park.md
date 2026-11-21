# Central Park Loop: art brief

The full loop of Central Park's drives in Manhattan, counter-clockwise: 9.9 km, 55 m of climbing, the only real
hill is Harlem Hill in the north-west corner. A city route (`category: city`). Data notes:
`research/central-park/sources.md`.

**Mood:** a clear autumn morning. Low sun through elms and oaks, long shadows on the drive, the towers of Midtown
standing over the tree line. Runners everywhere.

**Hero categories** (scorecard, need 4+): built environment, vegetation, sense of place.

## Hero moments

| # | km | Moment | What has to be right |
|---|---|---|---|
| C1 | south end | The skyline over the trees | The tall slim towers of 57th Street ("Billionaires' Row") and Central Park South behind the canopy: real heights and shapes, glass next to stone |
| C2 | west side | Central Park West | A wall of pre-war apartment houses 12 to 30 floors high in limestone and buff brick, several with twin towers (San Remo, Eldorado, Majestic, Century) |
| C3 | east side | Fifth Avenue | Limestone and white-brick apartment houses of even height behind the trees |
| C4 | whole loop | The drive | A wide park road with no cars: people running and walking in the inside lane, cyclists, black lamp posts, lawns and big trees right up to the kerb |

## Look targets

**Road.** Asphalt drive about 8 m wide here (the real one is wider in places). A solid white line splits off the lane
for people on foot on the inside of the loop (the left when riding counter-clockwise). No centre dashes, no
delineator posts, no guard rails. Bike symbols and lane arrows: not built yet.

**Ground.** Mown lawn up to the drive, bare earth and leaf litter under the trees. Outcrops of dark grey Manhattan
schist: not built yet. No meadow tufts, no ferns, no cattle.

**Vegetation.** Almost all broadleaf: American elm, London plane, pin oak, red oak, maple. Open-grown, wide crowns
that meet over the drive. Autumn colour in season. Positions and heights come from the canopy model, so lawns stay
open and woods stay closed. Never spruce.

**Buildings.** Flat roofs everywhere. Pre-war apartment houses: stone base of two floors, brick or limestone above,
rows of sash windows, a cornice, a wooden water tank and a bulkhead on the roof. Side streets: brownstone and brick
row houses of 4 to 5 floors. Midtown: glass curtain walls. Shapes, heights, colours and materials come from OSM's 3D
building parts where mapped. What must never appear: pitched tile roofs, plaster farmhouses, shutters, balconies with
flowers.

**Landmarks.** Built: the schist wall around the park, a black railing at the Reservoir (not yet seen in a still).
Not built yet: Bethesda Terrace, Bow Bridge, the
Met's rear facade, the arches and bridges over and under the drive.

**Life.** No cars (the drives have been closed to traffic since 2018). Runners and walkers in the inside lane and on
the paths, cyclists on the drive. Not built yet: pedicabs, horse carriages, dogs.

**Light.** Default morning or golden hour.

## References (board)

None collected yet. This brief is written from general knowledge of the park, not from a photo board; a board is
needed before any score counts as final.

## Open issues

- Tree models are the Alpine beech in different sizes; elm (vase shape) and plane (mottled trunk) would read as New York.
- Ground-floor shop fronts, awnings, canopies at the apartment-house doors: none.
- The far glass towers have a character each now (concrete grid, dark, silver stepped, 1960s box) and crowns, but no reflections of neighbours. Twin towers on the big CPW houses are generated from footprint and height, not from the real buildings (OSM maps San Remo, Majestic etc. as single outlines).
- The route's own bridges and underpasses are not modelled.

## Feedback log

| Date | Chris said | Reason | Status |
|---|---|---|---|
| 2026-11-21 | "It doesn't feel and look like Central Park, and also not like New York. The buildings are very blockish, not a lot of details. Cars are driving there." Road cracks don't matter; the surroundings, trees and buildings do. | Rode it and didn't recognise the place | First pass built (branch `central-park`): 3D buildings in a Manhattan style, baked trees, lawn, park lamps, no cars, people on the drive |
| 2026-11-21 | "At the end there are two hiccups where it's not a closed loop: the cyclist turns around and goes the other way." | Breaks the ride | Fixed: five dead-end spurs and the spur at the start cut out of the route (9.89 → 9.79 km) |

## Status

Second pass 2026-11-21 (facades with cornices and shop fronts, elm/plane/oak, people, benches, the perimeter wall,
outcrops). Reviews: r1 REJECT 3.00 (built 2, place 2), r2 REJECT 3.25 (built 3, place 3),
`research/central-park/review-2026-11-21-r2.md`; no board yet. Next: skyline towers that can be told apart (C1),
apartment-house detail that reads from 200 m (C2), lawn tufts and speckle, people in the capture frames.
A small chicane is left at km 8.3 where the route swings through the 72nd Street junction.
