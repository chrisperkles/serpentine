# Gaisberg geodata survey

Area of interest: lat 47.775–47.830, lon 13.080–13.135 (WGS84). Summit 47.8038, 13.1110.
All downloads used `User-Agent: SerpentineResearch/1.0`. Every file below was opened and checked with rasterio/PIL/JSON after download. Only items marked WORKS were downloaded and verified for the bbox.

Output folder: `/Users/chrisperkles/Documents/Git/serpentine/research/gaisberg/data/` (subfolders `als`, `buildings`, `chm`, `eea`, `basemap`, `other`).

Summary of status:

| # | Item | Status |
|---|------|--------|
| 1a | BEV ALS DTM 1 m (Austria) | WORKS, downloaded 2026-11-21 as windowed COG reads; baked into the terrain (see 1a) |
| 1b | Land Salzburg DGM 1 m / DOM 1 m (SAGIS) | PARTIAL: format verified on a city test tile, Gaisberg bbox not downloaded |
| 2 | LoD2 / 3D buildings | NOT FOUND for Land Salzburg; Stadt Salzburg 3D city model exists but is manual |
| 3 | Meta/WRI canopy height (1 m) | WORKS (v2 and v1) |
| 4 | Copernicus HRL Dominant Leaf Type 2018 and Tree Cover Density 2018 | WORKS |
| 5 | basemap.at WMTS | WORKS |
| 6 | Other sources | Land Salzburg Oberhöhe polygons WORKS; Land Salzburg orthophoto (1.5 m effective) WORKS; Copernicus DEM GLO-30 WORKS as fallback; BFW / Waldkarte not checked |

---

## 1. Austrian ALS terrain (DGM and DOM, 1 m)

### 1a. BEV (Bundesamt für Eich- und Vermessungswesen) ALS DTM, 1 m

- **Status: WORKS (2026-11-21), in use.** Earlier scripted attempts at the directory listings returned 403; the tile files themselves are plain HTTPS cloud-optimised GeoTIFFs and can be read as windows.
- **Credit:** ALS DTM 1 m, © Bundesamt für Eich- und Vermessungswesen (BEV), CC BY 4.0. Listed in the README's data table.
- Tile URL pattern: `https://data.bev.gv.at/download/ALS/DTM/20250915/ALS_DTM_CRS3035RES50000mN{N}E{E}.tif` (50 km tiles in EPSG:3035, N/E are the tile's lower-left corner in metres).
- File used: `research/gaisberg/data/als/gaisberg_dgm1m_bev_2025_EPSG3035.tif` (gitignored): float32, 1 m, 4856 x 4699 px, EPSG:3035, nodata -9999, covering the route, its lead-in and about 450 m around them. It agrees with the route's stored heights to 0.2 m on average (0.9 m standard deviation).
- Baked into `public/dem/16/` (80 tiles, 1.6 m per pixel, within 400 m of the route, its lead-in and turnarounds, fading into a smoothed copy of the same lidar over the outer 120 m) and `public/dem/17/` (122 tiles, 0.8 m per pixel, within 90 m, fade 40 m), 14 MB together, listed in `public/dem/index.json`. Reproduce with:

```
python scripts/bake-dem.py gaisberg research/gaisberg/data/als/gaisberg_dgm1m_bev_2025_EPSG3035.tif --zoom 16 --corridor 400 --fade 120
python scripts/bake-dem.py gaisberg research/gaisberg/data/als/gaisberg_dgm1m_bev_2025_EPSG3035.tif --zoom 17 --corridor 90 --fade 40
```

- Notes: it is bare earth, so the real road bed, cuts, fills, ditches and walls are in it. Tile pixels beyond the lidar's edge are stored as 0 0 0 ("no data") and the engine uses the coarser tile there. The lidar and the global 10 m tiles differ by about 0.3 to 1 m at the edge of the baked area (a few metres on steep cliffs).

### 1b. Land Salzburg (SAGIS) DGM 1 m and DOM 1 m

- Land Salzburg's download info page (`https://www.salzburg.gv.at/themen/salzburg/sagis/sagis-downloadinfos`) lists "ALS-Daten im OGD-Portal: DGM und DOM 1m".
- **DGM GeoTIFF: format verified, Gaisberg bbox not downloaded.**
  - Direct zip (test data): `https://static.salzburg.gv.at/sagisdaten_download/SAGIS_Daten/RP_DGM_GEOTIFF.zip` (814 KB, HTTP 200, accepts byte ranges). It holds `rp_dgm1m.tif` plus a `.tfw`.
  - Verified: float32, 1 m, 612 x 609 px, CRS MGI / Austria GK M31 (EPSG:31287), values 419.5 to 579.8 m, nodata -3.4e38.
  - **Caveat: this tile is in Salzburg city centre (13.046–13.054 E, 47.801–47.807 N). It does not cover the Gaisberg bbox.** It is a format sample only.
  - Saved as `data/als/salzburg_city_SAMPLE_not_gaisberg_dgm1m_EPSG31287.tif`.
- **Bbox download: LOGIN NEEDED / interactive.** The OGD and ALS download portals are interactive DataLinq apps (`https://www.salzburg.gv.at/api5/datalinq/report/vektorpublik%40alsdownload%40alsdownload?`, which needs JavaScript and an HMAC auth object; and `service.salzburg.gv.at/ogd/client/`). I did not find a scriptable URL pattern for tiles. The static zip pattern (`RP_DGM_GEOTIFF.zip`) is a sample, not per-tile.
- **DOM 1 m: not downloaded.** The ArcGIS service `Schummerung_DOM_Land_Salzburg` is a rendered hillshade, not heights (see section 6).
- Licence: SAGIS says the base geodata are free to use with source credit ("Quelle: Land Salzburg"). The OGD terms are CC-BY 4.0 per the Stadt Salzburg infoblatt. Confirm on the portal before shipping.
- Resolution: 1 m. CRS: EPSG:31287 (MGI / Austria GK M31).

---

## 2. Building models (LoD2 / 3D)

- **Status: NOT FOUND** for Land Salzburg. The SAGIS download list has no building or LoD2 product. Searches for Land Salzburg LoD2 and CityGML returned nothing relevant.
- **Stadt Salzburg 3D city model (not Land-wide): exists, manual download.**
  - Source: Informationsblatt "vorhandene Geodaten und deren Bereitstellung", MA 6/03 Vermessung und Geoinformation, November 2025 (`https://stadt-salzburg.at/fileadmin/user_upload/04013/infoblatt_geodatenbereitstellung.pdf`, downloaded and read).
  - It lists "3D Stadtmodell (Geometriedaten) aus dem ALS-Modell (DXF und GML)" as Open Government Data under CC-BY 4.0, downloadable through the Stadtplan application `https://maps.stadt-salzburg.at/`.
  - Caveats: it is derived from ALS (so probably block-model geometry, not a true LoD2 with roof types). Coverage of the Gaisberg is unverified. The Gaisberg summit area is not clearly inside the city boundary. Check coverage with the Gemeindegrenzen layer.
  - Not downloaded; the Stadtplan download is interactive. Contact geodaten@stadt-salzburg.at if needed.
- Land Salzburg's MAGIS 3D mesh (`https://maps.stadt-salzburg.at/3d/`) is an interactive viewer, not a data source.

---

## 3. Meta / WRI global canopy height (CHM), 1 m

- **Status: WORKS** (v2, and v1 as the fallback).
- Bucket: `s3://dataforgood-fb-data` (public). HTTP access: `https://dataforgood-fb-data.s3.amazonaws.com/`.
- Tile index: `https://dataforgood-fb-data.s3.amazonaws.com/forests/v2/global/dinov3_global_chm_v2_ml3/tiles.geojson` (58.9 MB) and `.../forests/v1/alsgedi_global_v6_float/tiles.geojson` (15.2 MB).

### v2 (DINOv3, ml3) — preferred

- Tile covering the bbox: **`1202300301`** (zoom 10). Tile extent: 13.008–13.359 E, 47.754–47.990 N.
- Template: `https://dataforgood-fb-data.s3.amazonaws.com/forests/v2/global/dinov3_global_chm_v2_ml3/chm/{quadkey}.tif`
- Source: `chm/1202300301.tif`, 32768 x 32768, uint8, EPSG:3857, 1.194 m native, 512x512 blocks, overviews 2/4/8. Scale 1, offset 0, no nodata tag.
- Read via GDAL `/vsicurl/` with a windowed read. The full 174 MB tile was not saved.
- Output (cropped and reprojected to UTM 33N, 1.0 m, nearest neighbour):
  - `data/chm/gaisberg_chm_v2_1m_utm33n.tif`: 5326 x 7754 px, uint8, EPSG:32633, 1.0 m. Values 0 to 43 (mean 9.6, about 60% of pixels > 0; 0 presumably means no canopy). Verified.
  - `data/chm/gaisberg_chm_v2_quicklook.png`: 1099 x 1600, grey-green ramp scaled to p99 = 29 m.
- Licence: not verified from the bucket (no licence file in the listed prefixes). Meta/WRI describe the global CHM as CC BY 4.0. Confirm on the source before shipping.

### v1 (alsgedi_global_v6_float) — fallback

- Tile covering the bbox: **`120230030`** (zoom 9). Tile extent: 12.656–13.359 E, 47.517–47.990 N.
- Template: `https://dataforgood-fb-data.s3.amazonaws.com/forests/v1/alsgedi_global_v6_float/chm/{quadkey}.tif`
- Source `chm/120230030.tif`: 623 MB, uint8 in this bucket (despite the "float" name), EPSG:3857, 1.194 m native, metadata UNITS=METERS.
- Output (same processing as v2):
  - `data/chm/gaisberg_chm_v1_1m_utm33n.tif`: 5314 x 7736 px, EPSG:32633, 1.0 m, values 0 to 35 (mean 7.5, 56% > 0). Verified.
  - `data/chm/gaisberg_chm_v1_quicklook.png`.
- Notes: v2 and v1 differ by about 8 m at the max (43 vs 35) over the same area. Use v2 as primary. The CHM is a single canopy height per 1 m pixel, not a DSM-DGM difference, so no ALS workflow is needed.

---

## 4. Copernicus HRL Dominant Leaf Type and Tree Cover Density (10 m)

- **Status: WORKS** (2018 products, both).
- Services are under `GioLandPublic` on the EEA ImageServer:
  - `https://image.discomap.eea.europa.eu/arcgis/rest/services/GioLandPublic/HRL_DominantLeafType2018/ImageServer`
  - `https://image.discomap.eea.europa.eu/arcgis/rest/services/GioLandPublic/HRL_TreeCoverDensity_2018/ImageServer`
- Request used (exportImage, native 10 m, no resampling):
  `.../ImageServer/exportImage?bbox=4551658.23,2744962.98,4556026.20,2751243.49&bboxSR=3035&imageSR=3035&size=437,628&format=tiff&pixelType=U8&interpolation=RSP_NearestNeighbor&f=image`
- Native CRS: EPSG:3035 (ETRS89-extended / LAEA Europe). Pixel size 10 m. Extent of the exported bbox: 437 x 628 px.
- **Dominant Leaf Type 2018** (`data/eea/gaisberg_HRL_DominantLeafType_2018_10m_EPSG3035.tif`):
  - Values found in the bbox: 0 (105,219 px), 1 (103,092 px), 2 (66,125 px). Total 274,436 px = 437 x 628.
  - Codes: 0 = non-forest, 1 = broadleaved, 2 = coniferous. These meanings come from the HRL DLT product specification, not from the service legend. The legend the service returns lists 0–254 as a generic colour map with no labels. Check the spec before relying on it.
  - Among forest pixels this is about 61% broadleaved (103,092) and 39% coniferous (66,125). About 38% of bbox pixels are non-forest.
- **Tree Cover Density 2018** (`data/eea/gaisberg_HRL_TreeCoverDensity_2018_10m_EPSG3035.tif`):
  - Values: 0 = all non-tree and non-forest areas (105,219 px, same count as DLT 0). 1–100 = % tree cover density. Dense values are common: about 83,000 px at 90–100 %, with 13,044 px at exactly 100 %. 255 = outside area (none in this bbox).
- Licence: Copernicus Land Monitoring Service products are free and open with attribution ("Copernicus Land Monitoring Service / EEA"). Confirm on `https://land.copernicus.eu/` before shipping.
- Other years (2012, 2015, 2021 DLT/TCD products also exist in the same folder) were not downloaded.

---

## 5. basemap.at (Austria WMTS)

- **Status: WORKS.** Capabilities document downloaded and parsed: `https://mapsneu.wien.gv.at/basemap/1.0.0/WMTSCapabilities.xml`.
- Host note: the capabilities advertise `maps1.wien.gv.at` and `maps2.wien.gv.at`. Those hosts do not resolve from this network. `mapsneu.wien.gv.at` and `maps.wien.gv.at` both serve the same tiles. Use `mapsneu.wien.gv.at`.
- Tile order in all templates: `{z}/{y}/{x}` (TileRow = y, TileCol = x), TileMatrixSet `google3857` (Web Mercator).

### Layers, templates, and max zoom at the summit (47.8038, 13.1110)

Summit tile indices: z17 (y 45669, x 70309), z18 (y 91338, x 140619), z19 (y 182676, x 281238), z20 (y 365352, x 562476).

| Layer | URL template | Format | Max zoom served at summit | Notes |
|-------|--------------|--------|--------------------------|-------|
| `bmaporthofoto30cm` (orthophoto) | `https://mapsneu.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg` | jpeg 256 | **19** (z19 200; z20 404) | Orthophoto, source 30 cm (name). At z19 the ground pixel is about 0.2 m at this latitude. |
| `bmapoberflaeche` (surface, grey shading) | `https://mapsneu.wien.gv.at/basemap/bmapoberflaeche/grau/google3857/{z}/{y}/{x}.jpeg` | jpeg 256 | **17** (z17 200; z18 404) | WMTS set `google3857_0-17`. Surface model shading (includes trees and buildings), rendered only. |
| `bmapgelaende` (terrain, grey shading) | `https://mapsneu.wien.gv.at/basemap/bmapgelaende/grau/google3857/{z}/{y}/{x}.jpeg` | jpeg 256 | **17** (z17 200; z18 404) | WMTS set `google3857_0-17`. Bare-earth shading, rendered only. |
| `bmaphidpi` (high-DPI base) | `https://mapsneu.wien.gv.at/basemap/bmaphidpi/normal/google3857/{z}/{y}/{x}.jpeg` | jpeg 512 | 19 (z19 200) | Not tested at z20. |
| `bmapgrau` (grey base) | `https://mapsneu.wien.gv.at/basemap/bmapgrau/normal/google3857/{z}/{y}/{x}.png` | png 256 | 19 (z19 200) | Base map, not useful for 3D. |
| `geolandbasemap` | `https://mapsneu.wien.gv.at/basemap/geolandbasemap/normal/google3857/{z}/{y}/{x}.png` | png 256 | 19 (z19 200) | Base map. |
| `bmapoverlay` | `https://mapsneu.wien.gv.at/basemap/bmapoverlay/normal/google3857/{z}/{y}/{x}.png` | png | not tested | Labels overlay. |

- The "bmapoberflaeche" and "bmapgelaende" names say "grau" (grey). They are rendered hillshade images with no elevation values, so they cannot replace height data. They are useful as visual references.
- Samples saved in `data/basemap/`, each verified by PIL:
  - `ortho_z19.jpeg` (256 x 256 RGB)
  - `oberflaeche_z17.jpeg` (256 x 256 RGB)
  - `gelaende_z17.jpeg` (256 x 256 RGB)
  - `hidpi_z19.jpeg` (512 x 512 RGB)
  - `grau_z19.png` (256 x 256 P)
  - `geolandbasemap_z19.png` (256 x 256 P)
- Licence: basemap.at data is generally stated as CC BY 4.0 with attribution "basemap.at" (plus BEV / Land attribution for the orthophoto). Confirm on `https://www.basemap.at/` before shipping.

---

## 6. Other sources

### 6a. Land Salzburg forest stand height (FAI "Oberhöhe")

- **Status: WORKS** (vector features, queried for the bbox).
- Service: `https://service.salzburg.gv.at/arcgis/rest/services/FAI_Collect_Oberhoehe_Land_Salzburg/MapServer/0` (layer "Oberhöhe", query-capable, EPSG:31258 native).
- Fields: `Oberhoehe` / `Oberhoehe_m` (stand mean height, m), `Uebersch` (canopy closure), `Vorrat` / `Vorrat_VFM` (growing stock, m3/ha).
- Query used: envelope in 4326 with `outSR=4326`, paged (2000 per request, orderBy OBJECTID).
- Result: 7,509 polygons. `Oberhoehe_m` min 0, max 42, mean 26.7 m. (A count-only query returned 7,432; the difference is probably due to edge polygons. Treat as approximately 7.5k.)
- Saved: `data/other/gaisberg_land_salzburg_FAI_oberhoehe_polygons_wgs84.geojson`.
- Notes: this is a stand-level forest inventory product (polygons), not per-tree. Useful for per-stand tree height and density, not for individual tree placement. Licence: SAGIS / OGD, confirm.
- `FAI_Collect_Objekthoehe_Land_Salzburg` (object heights) exists but returns "Invalid or missing input parameters" for queries, so it is not queryable. Not downloaded.

### 6b. Land Salzburg orthophoto (ArcGIS export)

- **Status: WORKS, but resolution is about 1.5 m, not 20 cm.**
- Service: `https://service.salzburg.gv.at/arcgis/rest/services/Orthofoto_Land_Salzburg/MapServer` (layer "Orthofotos").
- Export call: `.../MapServer/export?bbox=431069.58,292963.65,435207.71,299066.75&bboxSR=31258&imageSR=31258&size=2777,4096&format=png&f=image`. The server caps at `maxImageHeight` 4096, so a 20 cm request is capped and comes back at about 1.49 m per pixel.
- Saved as a georeferenced GeoTIFF from the known extent: `data/other/gaisberg_land_salzburg_ortho_1.5m_effective_31258.tif`. 4096 x 2777 px, RGB, EPSG:31258. Verified.
- For true 20 cm or 30 cm colour, use the Land Salzburg orthophoto portal or static zips named `OF_F_20_TIFF.zip` / `OF_RGB_12_SID.zip` on `static.salzburg.gv.at` (per sheet, Triangulierungsblatt). Those were listed but not downloaded.
- Licence: SAGIS, confirm.

### 6c. Copernicus DEM GLO-30 (30 m, fallback terrain)

- **Status: WORKS** (public S3, cropped to bbox).
- Tile: `https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N47_00_E013_00_DEM/Copernicus_DSM_COG_10_N47_00_E013_00_DEM.tif` (42 MB, HTTP 200). Read via `/vsicurl/`.
- Saved: `data/other/gaisberg_copernicus_dem_glo30_fallback.tif`, 198 x 198 px, float32, EPSG:4326, about 0.000278 deg (30 m). Values 422.6 to 1287.2 m. The 1287 m maximum matches the Gaisberg summit height.
- This is a DSM (surface model, includes trees and buildings), 30 m. Only useful as a coarse fallback.
- Licence: Copernicus DEM, free with attribution ("© DLR e.V. 2020 and © Airbus Defence and Space 2020"). Check the licence text before shipping.

### 6d. Not checked

- BFW tree species map and the Austrian "Waldkarte": not searched or downloaded in this pass.
- Land Salzburg 3D mesh MAGIS: interactive only.

---

## Files saved

| Path (under `data/`) | Item | Status |
|------|------|--------|
| `chm/gaisberg_chm_v2_1m_utm33n.tif` | 3 (v2) | verified, 1 m, EPSG:32633, uint8 0–43 m |
| `chm/gaisberg_chm_v2_quicklook.png` | 3 | quick look |
| `chm/gaisberg_chm_v1_1m_utm33n.tif` | 3 (v1) | verified, 1 m, EPSG:32633, uint8 0–35 m |
| `chm/gaisberg_chm_v1_quicklook.png` | 3 | quick look |
| `eea/gaisberg_HRL_DominantLeafType_2018_10m_EPSG3035.tif` | 4 | verified, codes 0/1/2 |
| `eea/gaisberg_HRL_TreeCoverDensity_2018_10m_EPSG3035.tif` | 4 | verified, 0–100 % |
| `basemap/ortho_z19.jpeg` | 5 | verified |
| `basemap/oberflaeche_z17.jpeg` | 5 | verified |
| `basemap/gelaende_z17.jpeg` | 5 | verified |
| `basemap/hidpi_z19.jpeg` | 5 | verified |
| `basemap/grau_z19.png` | 5 | verified |
| `basemap/geolandbasemap_z19.png` | 5 | verified |
| `als/salzburg_city_SAMPLE_not_gaisberg_dgm1m_EPSG31287.tif` | 1b | sample only, city centre, not Gaisberg |
| `other/gaisberg_land_salzburg_FAI_oberhoehe_polygons_wgs84.geojson` | 6a | verified, 7,509 polygons |
| `other/gaisberg_land_salzburg_ortho_1.5m_effective_31258.tif` | 6b | verified, about 1.5 m |
| `other/gaisberg_copernicus_dem_glo30_fallback.tif` | 6c | verified, 30 m fallback |

## Working tools kept in scratchpad (not in the output folder)

- `gaisberg/chm_crop.py` (windowed reprojected CHM crop with quicklook), `gaisberg/tile_calc.py` (slippy tile indices).
- GIS venv: `/private/tmp/claude-501/-Users-chrisperkles-Documents-Git/879f1900-260f-4026-a18b-bb1a6429320c/scratchpad/gisenv` (rasterio 1.5.2, numpy, pillow).

## Open issues

1. BEV ALS (1a) returns 403 for scripted access. A browser session may be needed.
2. Land Salzburg 1 m DGM/DOM for the actual bbox: the download is interactive. Find the tile-level URL in the browser (network tab) if it is needed as a script.
3. No LoD2 for Land Salzburg was found. The Stadt Salzburg 3D model is manual and may not cover the Gaisberg.
4. The licence fields above come from the source pages and dataset descriptions, not from confirmed licence files for each product. Confirm before shipping.
