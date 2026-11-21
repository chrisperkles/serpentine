"""Bake individual trees for a preset route from a canopy height model.

Tree tops are local maxima of the (lightly smoothed) Meta/WRI 1 m canopy height map with a
height-dependent search window; species come from the Copernicus Dominant Leaf Type layer.
Writes public/trees/<id>.bin, read by src/engine/Vegetation.ts.

  python scripts/bake-trees.py gaisberg <chm.tif> <dlt.tif> [--corridor 550]
  python scripts/bake-trees.py gaisberg <chm.tif> <dlt.tif> --lead-in   adds the lead-in corridor
      (scripts/bake-leadin.py) to the existing bin, keeping every tree already in it
  python scripts/bake-trees.py central-park <chm.tif> - --conifer 0.02   outside Europe there is no
      leaf-type layer: '-' makes every tree a broadleaf except the given share

Needs rasterio, numpy, scipy, pyproj (use a venv; nothing here runs in the app).

File format (little endian): magic 'TRE1', u32 count, f64 lon0, f64 lat0, then per tree
f32 dlon, f32 dlat, u8 height (m), u8 crown radius (dm), u8 type (1 conifer, 2 broadleaf),
u8 flags (1 = open-ground tree outside forest).
"""
import json
import struct
import sys

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.features import rasterize
from scipy import ndimage

route_id, chm_path, dlt_path = sys.argv[1:4]
corridor = float(sys.argv[sys.argv.index('--corridor') + 1]) if '--corridor' in sys.argv else 550.0
# Mediterranean woodland is lower and denser than Alpine forest: --min-height 2.5 --window 0.6
min_h = float(sys.argv[sys.argv.index('--min-height') + 1]) if '--min-height' in sys.argv else 3.0
win = float(sys.argv[sys.argv.index('--window') + 1]) if '--window' in sys.argv else 1.0

route = json.load(open(f'public/routes/{route_id}.json'))
lead_in_only = '--lead-in' in sys.argv
lines = [route['leadIn']['coords']] if lead_in_only else [route['coords']] + ([route['leadIn']['coords']] if 'leadIn' in route else [])

with rasterio.open(chm_path) as src:
    chm = src.read(1).astype(np.float32)
    T = src.transform
    crs = src.crs
px = abs(T.a)  # metres per pixel

# corridor mask: distance (m) from the route polyline
to_utm = Transformer.from_crs('EPSG:4326', crs, always_xy=True)
geom = {'type': 'MultiLineString', 'coordinates': [[to_utm.transform(c[0], c[1]) for c in ln] for ln in lines]}
route_px = rasterize([(geom, 1)], out_shape=chm.shape, transform=T, all_touched=True)
dist = ndimage.distance_transform_edt(route_px == 0) * px
inside = dist <= corridor

# smooth a little to merge multi-peak crowns, then find tops with a height-dependent window
sm = ndimage.gaussian_filter(chm, sigma=1.1 / px)
tops = np.zeros(chm.shape, bool)
for lo, hi, radius_m in ((min_h, 10, 1.8), (10, 18, 2.6), (18, 26, 3.3), (26, 99, 4.0)):
    size = int(round(2 * radius_m * win / px)) | 1
    peak = sm == ndimage.maximum_filter(sm, size=size)
    tops |= peak & (sm >= lo) & (sm < hi)
tops &= inside & (chm >= min_h)
rows, cols = np.nonzero(tops)
heights = sm[rows, cols]

# --fill: satellite canopy models blur neighbouring crowns into blobs, so peaks alone give far
# too few trees in closed woodland. Plant more trees through the canopy pixels at a spacing
# that grows with tree height (Poisson-disk style, grid-hashed), so the cover matches the CHM.
if '--fill' in sys.argv:
    cell = 4.0  # metres per hash cell
    grid = {}
    def key(x, y):
        return (int(x // cell), int(y // cell))
    pts_x = list(cols * px)
    pts_y = list(rows * px)
    for x, y in zip(pts_x, pts_y):
        grid.setdefault(key(x, y), []).append((x, y))
    rng_f = np.random.default_rng(3)
    step = max(1, int(round(1.5 / px)))
    cand_r, cand_c = np.nonzero((sm[::step, ::step] >= min_h) & inside[::step, ::step])
    cand_r = cand_r * step + rng_f.integers(0, step, len(cand_r))
    cand_c = cand_c * step + rng_f.integers(0, step, len(cand_c))
    cand_r = np.clip(cand_r, 0, sm.shape[0] - 1)
    cand_c = np.clip(cand_c, 0, sm.shape[1] - 1)
    order = rng_f.permutation(len(cand_r))
    add_r, add_c = [], []
    for k in order:
        r_, c_ = cand_r[k], cand_c[k]
        h_ = sm[r_, c_]
        if h_ < min_h:
            continue
        rad = max(2.8, 0.36 * h_ + 0.8)
        x, y = c_ * px, r_ * px
        kx, ky = key(x, y)
        ok = True
        for gx in (kx - 1, kx, kx + 1):
            for gy in (ky - 1, ky, ky + 1):
                for (ox, oy) in grid.get((gx, gy), ()):
                    if (ox - x) ** 2 + (oy - y) ** 2 < rad * rad:
                        ok = False
                        break
                if not ok:
                    break
            if not ok:
                break
        if ok:
            grid.setdefault((kx, ky), []).append((x, y))
            add_r.append(r_)
            add_c.append(c_)
    print(f'fill: +{len(add_r)} trees in canopy gaps')
    rows = np.concatenate([rows, np.array(add_r, dtype=rows.dtype)])
    cols = np.concatenate([cols, np.array(add_c, dtype=cols.dtype)])
    heights = sm[rows, cols]

xs, ys = rasterio.transform.xy(T, rows, cols)
xs, ys = np.asarray(xs), np.asarray(ys)

# crown radius from spacing: neighbouring crowns touch, so the canopy closes like in the CHM
from scipy.spatial import cKDTree
nn, _ = cKDTree(np.c_[xs, ys]).query(np.c_[xs, ys], k=2)
crown = np.clip(0.62 * nn[:, 1], 1.4, np.clip(0.9 + 0.17 * heights, 2.0, 7.5))

# openness: share of canopy around each tree (forest interior vs single tree / hedge)
canopy = ndimage.uniform_filter((chm >= 3).astype(np.float32), size=int(25 / px))
open_ground = canopy[rows, cols] < 0.35

to_ll = Transformer.from_crs(crs, 'EPSG:4326', always_xy=True)
lon, lat = to_ll.transform(xs, ys)

# species from Copernicus DLT (0 none, 1 broadleaved, 2 coniferous); mixed edges get a share of the other type
if dlt_path == '-':
    leaf = None
else:
    with rasterio.open(dlt_path) as d:
        dlt = d.read(1)
        to_d = Transformer.from_crs('EPSG:4326', d.crs, always_xy=True)
        dx, dy = to_d.transform(lon, lat)
        r, c = rasterio.transform.rowcol(d.transform, dx, dy)
        r = np.clip(np.asarray(r), 0, dlt.shape[0] - 1)
        c = np.clip(np.asarray(c), 0, dlt.shape[1] - 1)
        leaf = dlt[r, c]
rng = np.random.default_rng(7)
u = rng.random(len(lon))
if leaf is None:
    conifer = u < (float(sys.argv[sys.argv.index('--conifer') + 1]) if '--conifer' in sys.argv else 0.0)
else:
    conifer = np.where(leaf == 2, u < 0.86, np.where(leaf == 1, u < 0.12, u < 0.22))
# tall narrow tops in closed forest above ~900 m are mostly spruce on the Gaisberg; leave as DLT says
kind = np.where(conifer, 1, 2).astype(np.uint8)

REC = [('dlon', '<f4'), ('dlat', '<f4'), ('h', 'u1'), ('cr', 'u1'), ('k', 'u1'), ('f', 'u1')]
lon, lat = np.asarray(lon), np.asarray(lat)
old = None
if lead_in_only:
    # the existing bake already covers the route corridor: add only trees outside it
    dense = []
    for main in (route.get('originalCoords', []), route['coords']):
        for a, b in zip(main, main[1:]):
            ax, ay = to_utm.transform(a[0], a[1])
            bx, by = to_utm.transform(b[0], b[1])
            k = max(1, int(np.hypot(bx - ax, by - ay) // 4))
            dense += [(ax + (bx - ax) * t / k, ay + (by - ay) * t / k) for t in range(k)]
    keep = cKDTree(np.asarray(dense)).query(np.c_[xs, ys])[0] > corridor
    lon, lat, heights, crown, kind, open_ground = (v[keep] for v in (lon, lat, heights, crown, kind, open_ground))
    blob = open(f'public/trees/{route_id}.bin', 'rb').read()
    n_old, lon0, lat0 = struct.unpack('<Idd', blob[4:24])
    old = np.frombuffer(blob[24:24 + n_old * 12], dtype=REC)
    print(f'lead-in: {int(keep.sum())} new trees outside the existing corridor ({n_old} kept)')
else:
    lon0, lat0 = float(np.mean(lon)), float(np.mean(lat))
rec = np.zeros(len(lon), dtype=REC)
rec['dlon'] = lon - lon0
rec['dlat'] = lat - lat0
rec['h'] = np.clip(np.round(heights), 0, 255)
rec['cr'] = np.clip(np.round(crown * 10), 0, 255)
rec['k'] = kind
rec['f'] = open_ground.astype(np.uint8)
if old is not None:
    rec = np.concatenate([old, rec])
n = len(rec)
buf = bytearray(b'TRE1' + struct.pack('<Idd', n, lon0, lat0))
buf += rec.tobytes()
import os
os.makedirs('public/trees', exist_ok=True)
open(f'public/trees/{route_id}.bin', 'wb').write(buf)
print(f'{route_id}: {n} trees ({int((rec["k"] == 1).sum())} conifer, {int((rec["k"] == 2).sum())} broadleaf, '
      f'{int(rec["f"].sum())} open-ground), mean height {rec["h"].mean():.1f} m, {len(buf) / 1e6:.2f} MB')
