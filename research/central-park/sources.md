# Central Park: data sources

- **Buildings.** OpenStreetMap (ODbL). Besides `building` ways the bake now takes `building:part` ways and
  relations (own `height`, `min_height`, `building:colour`, `building:material`, `roof:shape`) and multipolygon
  buildings. Fetched 2026-11-21 from overpass-api.de in three queries: parts and relations around the park
  (40.7560,-73.9900 to 40.8050,-73.9420), everything in Midtown south of it (40.7480,-73.9960 to 40.7600,-73.9620)
  and park details (walls, street lamps, pitches, grass, bare rock, bridges). Merged with
  `node scripts/bake-osm.mjs central-park --add=<files>`. Result: 32,821 elements, 12,372 buildings and parts.
- **Trees.** Meta / WRI global canopy height v2, 1 m, tile `0320101101`
  (`dataforgood-fb-data.s3.amazonaws.com/forests/v2/global/dinov3_global_chm_v2_ml3/chm/`), cropped to the park and
  warped to UTM 18N. Described by Meta/WRI as CC BY 4.0; not verified from the bucket. Baked with
  `python scripts/bake-trees.py central-park <chm.tif> - --corridor 600 --window 0.8`: 13,952 trees, all broadleaf
  (there is no leaf-type layer outside Europe; the park is almost entirely deciduous). `--fill` gave 123,000 trees,
  far too many: the park has about 18,000.
- **No photo board yet.** Nothing was scraped.
