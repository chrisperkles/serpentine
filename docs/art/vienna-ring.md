# Wiener Ringstraße: art brief

The loop of Vienna's Ringstraße and the Franz-Josefs-Kai along the Danube Canal: 5.9 km, 16 m of climbing, flat. A city
route (`category: city`). Clockwise from the Stubenring: Parkring (Stadtpark), Schubertring, Kärntner Ring (Opera),
Opernring, Burgring (Hofburg, Kunst- and Naturhistorisches Museum), Dr.-Karl-Renner-Ring (Parliament), Universitätsring
(Rathaus, Burgtheater, University), Schottenring (Börse, Votivkirche), then the Kai back to the start. OSM data:
`public/osm/vienna-ring.json` (3D building parts, tram tracks, lamps, benches, parks).

**Mood:** a clear late-autumn noon. Cream and ochre stone fronts in low sun, plane and lime trees turning yellow along
the carriageway, red trams on their own lanes, the green copper domes and grey spires of the monuments over the roofs.
A city that is busy but not hurried.

**Hero categories** (scorecard, need 4+): built environment, sense of place, vegetation.

## Hero moments

| # | km | Moment | What has to be right |
|---|---|---|---|
| V1 | 0.3 to 1.3 | Parkring and Stadtpark | Palais-like blocks of five to six floors on the left, the park's lawns and old trees on the right behind iron railings |
| V2 | 1.8 to 2.0 | Opernring | The Opera's long cream front, tall Gründerzeit blocks, trams on the Ring |
| V3 | 2.2 to 2.9 | Burgring and the museums | Hofburg wings, the two big museums with green domes, Heldenplatz and the Volksgarten (lawn and railings, wide pale paving) |
| V4 | 2.9 to 3.5 | Parliament, Rathaus, Burgtheater, University | Monuments, not blocks: stone colour per building, towers, domes, spires; the Rathaus tower with its grey neo-Gothic spires |
| V5 | 4.0 to 4.9 | Schottenring | Votivkirche's twin spires over the roofs, tall business blocks, the Börse |
| V6 | 5.0 to 5.9 | Franz-Josefs-Kai | The Danube Canal on one side, a long wall of blocks on the other; a few modern glass buildings |

## Look targets

**Road.** A wide city carriageway; no edge lines, a short dashed lane line. Cars in both directions (it is a real
traffic street), cyclists in the carriageway. Trams run on their own tracks beside it: steel rails in a dark paved bed.
Road-surface detail is not the point.

**Ground.** Pavement, cobbles and wide pale squares beside the road; lawn only inside the parks (Stadtpark, Burggarten,
Volksgarten, Rathauspark) and on the odd mapped verge. Never meadow tufts, ferns or cattle along the street.

**Vegetation.** Avenue trees in rows along the road (lime, plane, maple; the park-tree models with a narrower crown),
old plane trees in the parks. Yellow to orange in November. Never spruce.

**Buildings.** Ringstraße historicism: five or six tall storeys, eaves around 22 to 26 m. Cream, ochre, grey-beige and
"Schönbrunn yellow" plaster; a rusticated ground floor with arches or shop windows and the odd portal; a mezzanine; tall
windows with triangular and segmental pediments on the piano nobile; plain windows with lintels above; a strong stone
cornice; slate-grey or clay hip roofs and steeper mansards with dormers; brick chimney stacks. Corner towers, domes,
onion caps and spires where OSM's 3D parts have them, with the roof colour from the tags (copper green, grey slate).
Monuments (Opera, Parliament, Rathaus, museums, Votivkirche, University, Burgtheater) are drawn from parts in stone
colours taken from what the buildings are, with wider bays and pilasters. Glass only where OSM tags glass (a few
towers on the Kai). What must never appear: Alpine plaster farmhouses, shutters, timber upper storeys, geranium
balconies, firewood stacks, glass curtain walls on historic blocks.

**Landmarks.** Not built as models: Rathaus, Parliament's pediment and Athena fountain, the Opera's loggia, the
Stephansdom's spire over the roofs, the Ring's monuments (Maria Theresia, Goethe, Schiller), Votivkirche beyond what
the OSM parts give.

**Lamps and furniture.** Slim dark masts on a fluted base with a curved arm and a cream glass lantern, at the OSM lamp
positions; park benches; iron railings round the parks (OSM fences), low stone walls.

**Life.** People on the pavements and in the parks (walking, standing in small groups), trams, cars, cyclists. Not
built yet: dogs, pushchairs, fiakers (horse carriages), tourists with cameras, café terraces on the pavements.

**Light.** Default noon or golden hour; low sun lights the cream stone best.

## References (board)

None collected. This brief is written from general knowledge of the Ringstraße, not from a photo board; a board is
needed before any score counts as final. No photos, Street View or Maps were used.

## Open issues

- No second wing for the courtyard blocks: the outline's courtyard is filled in (flat or hipped roof over it).
- Dormers are drawn in the roof shader, not as geometry; they vanish in silhouette.
- Windows have no reveals deeper than a shaded edge; no balconies, no shutters (right), no shop signs or awnings.
- Overlapping 3D parts of one monument show coplanar walls in two tints in places.
- Trams are boxes: no bogies, no doors, no destination text, no stops where they stand.
- The terrain under the quay and the canal wall is the orthophoto: a building standing at the canal edge can sink.
- The route's lane for trams: tracks that cross the carriageway are cut out, so trams stop at junctions' edges.

## Feedback log

| Date | Chris said | Reason | Status |
|---|---|---|---|
| 2026-11-21 | City routes "don't feel like the real place"; buildings "blockish, not a lot of details"; cares about surroundings (buildings, trees), not road-surface detail | Rode the Ring and saw white Salzburg farmhouse blocks, meadow grass and highway lamps | First pass built (branch `city-vienna`): Vienna building style, city ground, avenue trees, lamps, trams, people |

## Status

First pass 2026-11-21 on branch `city-vienna`, not reviewed yet (no `serpentine-reviewer` run, no board).
