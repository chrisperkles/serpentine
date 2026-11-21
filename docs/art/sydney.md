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

- Trees come from a canopy model that cannot tell species apart; species are guessed from distance to the sea and from
  OSM parks. Real Norfolk pines stand where the model finds few trees (the Bondi promenade).
- Houses are extruded OSM footprints: no verandahs, no iron lace, no front fences, no garden walls.
- The Oxford Street shop fronts have generic awnings and glass; the Bondi Pavilion, Icebergs pool, Bronte baths and the
  Coogee jetty are not built.
- Not checked: whether the sun path is right for the southern hemisphere.
- Ground photo (Esri) has pastel patches over built-up land; they are muted, not removed.
- Beach surf is the terrain water shader, no breaking waves.
- Power poles and overhead wires are not drawn.

## Feedback log

| Date | Chris said | Reason | Status |
|---|---|---|---|
| 2026-11-21 | City routes "don't feel like the real place"; surroundings (trees, buildings) matter, not the road surface | Same complaint as Central Park | First pass built (branch `city-sydney`) |

## Status

First pass 2026-11-21. Not reviewed by the `serpentine-reviewer` yet.
