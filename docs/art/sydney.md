# Sydney Coast & Park: art brief

Bondi Beach, the coast path south over the headlands to Tamarama, Bronte, Clovelly and Coogee, inland through Randwick,
Centennial Park, Oxford Street and Bondi Junction, back down to Bondi: 17.7 km loop, 228 m of climbing. A city route
(`category: city`).

**Mood:** a clear late-spring or early-summer morning in the southern hemisphere. High, hard sun, a deep blue sea with
white surf, pale sand, golden sandstone, grey-green gum crowns and dark fig domes. Joggers and walkers on the coast
path, cars on the left.

**Hero categories** (scorecard, need 4+): vegetation, built environment, sense of place.

## Hero moments

| # | km | Moment | What has to be right |
|---|---|---|---|
| S1 | 0.3 | Bondi Beach | A long curve of pale sand with surf, the promenade, 3 to 5 storey blond and red brick flats and Art Deco blocks facing the sea |
| S2 | 1.5 to 5 | The headlands | Golden sandstone cliffs and outcrops, low coastal heath, the sea always on the left or right, Norfolk Island pines on the beachfronts (Bronte, Coogee) |
| S3 | 6 to 9 | Randwick | Streets of red-brown brick bungalows and semis with terracotta tile roofs, nature strips, street trees, power poles |
| S4 | 10.5 to 13 | Centennial Park | Huge Moreton Bay figs on massive buttressed trunks, eucalypts, lawns, palms along Parkes Drive |
| S5 | 14 to 15 | Oxford Street and Bondi Junction | Shop terraces with awnings, the glass towers over the roofs |

## Look targets

**Road.** Ordinary suburban asphalt, white edge lines. No delineator posts, no guard rails. Cars keep to the left.

**Ground.** Beach sand where OSM says beach or sand; Hawkesbury sandstone (golden brown) on cliffs and bare rock; mown
kikuyu lawn (light yellow-green) in parks and reserves; nature strips and gardens in the streets. No meadow tufts, no
cattle.

**Vegetation.** Evergreen, no autumn colour. Eucalypts (tall pale smooth trunks, open grey-green crowns with drooping
leaf clumps), Moreton Bay figs in the parks (huge low dark domes on buttressed trunks), Norfolk Island pines within
about 400 m of the sea (tall, symmetric, tiered), leafy street trees (camphor laurel, brush box), a few palms at the
park edges, low heath and tussock on the headlands.

**Buildings.** Federation and Californian bungalows and semis of red-brown brick with hipped or gabled terracotta
roofs and a chimney; 1960s to 70s walk-ups of 3 to 4 floors in red and blond brick, balconies in every bay; Art Deco
render in cream, pale green and peach; shop terraces with awnings; glass and concrete towers at Bondi Junction, from OSM
heights. Never: plaster farmhouses, shutters, timber upper storeys, geranium balconies.

**Life.** Cars and vans on the left. Walkers and runners on the coastal path, groups on the lawns, a few cyclists. No
cows, paragliders or jackdaws. Surf and gulls in the audio near the sea.

**Light.** Noon or morning. In Sydney the sun stands in the north; whether the sky model does that was not checked.

## Which biome it starts from

A new `sydney` biome built on Alpine (spread of `ALPINE`), not Mediterranean. Mediterranean is tied to Mallorca in too
many places: karst limestone terrain shading, photo sea, Spanish signs and barriers, goats and coaches, garrigue plants.
What Sydney does take from it is the foliage atlas (`foliage-med.png`): its narrow leaves read as eucalypt and its
needle puffs as Norfolk pine tiers, and the evergreen tints. The four species slots are Norfolk pine (conifer F), fig
(conifer O), eucalypt (broadleaf F) and street tree (broadleaf O); a place decides the species (`sydneyTrees.ts`).

## References (board)

No photo board. This brief is written from general knowledge of Sydney's eastern suburbs, not from photographs; a board
is needed before any score counts as final. Nothing was scraped.

## Open issues

- Trees come from a canopy model that cannot tell species apart; species are guessed from distance to the sea, from OSM
  parks and from height (small peaks are banksia and tea-tree). Norfolk pines along the promenades are added by rule
  (park edges within 260 m of the sea, the road side where it runs along a beach), not from a tree survey.
- Houses are still extruded OSM footprints. Rectangular ones are now split into 6 to 7 m units (terrace rows, semis)
  with their own roof colours, party-wall fins, chimneys, verandahs and front walls; odd outlines keep one hip roof.
  No iron lace, no bullnose curves, no gable-end bargeboards, no garden fences on corner lots.
- The Oxford Street shop fronts have generic awnings and glass; the Bronte baths and the Coogee jetty are not built.
  Bondi Pavilion and the Icebergs club are boxes with windows and arcades, not photographs of the real buildings.
- Waverley Cemetery is not in the OSM data: the headstones fill a hand-drawn polygon (`Props.ts` `sydneyLandmarks`)
  and may be 20 to 40 m off the real wall.
- Not checked: whether the sun path is right for the southern hemisphere.
- Ground photo (Esri) has pastel patches over built-up land; they are muted, not removed (ground is another pass).
- Beach surf is the terrain water shader, no breaking waves. Nobody swims.
- Power poles and overhead wires are not drawn.
- People are one scanned figure in 40 clothing looks: pairs of identical outfits show up.

## Feedback log

| Date | Chris said | Reason | Status |
|---|---|---|---|
| 2026-11-21 | City routes "don't feel like the real place"; surroundings (trees, buildings) matter, not the road surface | Same complaint as Central Park | First pass built (branch `city-sydney`); second pass (`r3-sydney`) on life, gums, houses, landmarks |

## Status

First pass 2026-11-21: reviewer REJECT 2.88 (vegetation 3, built 3, life 2, place 3).

Second pass 2026-11-21 (`r3-sydney`), not reviewed yet:

- Life: no cars appeared because traffic only spawned 650 m out on a 6 to 20 s timer, so a paused capture (or the
  first half minute of a ride) saw an empty road. Traffic is now on the road at load and after any jump, comes every
  4 to 10 s, and the rider rides in the left lane (Engine: `lateral` -1.7 for `leftHand`; it was +1.7, so the rider
  sat in the oncoming lane). Parked cars at the kerb in front of houses, a blue and white bus, about 190 people:
  pavement walkers (busier near the sand), picnics, beach groups on towels, surfers with boards, dog walkers.
- Trees: two more crown shapes (angophora, banksia) and a rebuilt tall gum, six tree slots in Sydney, tones vary tree to
  tree, Norfolk pine rows on promenades.
- Houses and landmarks: see Open issues.

**Where to look (km along the route, the loop is 17.66 km):**

| What | km | Notes |
|---|---|---|
| Bondi Pavilion | 0.15 to 0.25 | beside the road on the beach side; `side` camera shows it best |
| Bondi beach, Norfolk pines, surfers and sand crowd | 0.2 to 0.7 | drone at 0.25 |
| Sandstone headland, Tamarama | 1.0 to 1.9 | chase at 1.0, drone at 1.8 |
| Bronte beachfront and its pines | 2.3 to 2.7 | chase at 2.48 |
| Waverley Cemetery headstones | 3.4 to 4.1 | drone at 3.65, on the left of the road |
| Randwick terraces, semis, verandahs | 5.8 to 9.0 | chase at 6.2, 6.5, 7.5 |
| Coogee beachfront | 7.0 to 7.2 | chase at 7.05 |
| Centennial Park (figs, gums, picnics) | 10.5 to 13.0 | chase at 11.0 and 13.5 |
| Oxford Street, Bondi Junction | 13.3 to 15.0 | chase at 14.8 shows terraces and a bus; the shop strip itself was not checked |
