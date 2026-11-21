"""Bake a high-resolution DEM into local Terrarium tiles that override the AWS terrain tiles.

  python scripts/bake-dem.py <route-id> <dem.tif> [--zoom 15] [--margin 2500]
  python scripts/bake-dem.py <route-id> <lidar.tif> --corridor 400 --fade 120 --zoom 16 [--zoom 17 ...]

Corridor mode (1 m lidar, e.g. BEV ALS DTM): bakes only tiles within --corridor metres of the route, its lead-in
and its turnaround loops, one pass per --zoom. Inside the corridor the tile holds the lidar; over the outer
--fade metres it fades into a smoothed copy of the same lidar (--lowpass, default 4 m sigma), which is what the
10 m global tiles look like, so the finer tiles meet the AWS tiles around them without a step. Tiles that
reach past the lidar's coverage are skipped. No network needed.

Samples the DEM (any CRS rasterio can read; e.g. IGN MDT05, 5 m) at every pixel of the
slippy-map tiles at --zoom that touch the route plus --margin metres, encodes Terrarium PNGs
into public/dem/<z>/<x>/<y>.png and adds them to public/dem/index.json, which the app reads
(src/geo/elevation.ts) to prefer local tiles. Cells outside the DEM keep the AWS height so the
tiles stay seamless.
"""
import json
import math
import os
import sys
import urllib.request

import numpy as np
import rasterio
from PIL import Image
from pyproj import Transformer
from rasterio.warp import transform as warp_transform

route_id, dem_path = sys.argv[1:3]
SIZE = 256
R = 6378137.0
MAXM = math.pi * R

def arg(name, default=None, cast=float):
    return cast(sys.argv[sys.argv.index(name) + 1]) if name in sys.argv else default


def corridor_bake():
    from scipy.ndimage import distance_transform_edt, gaussian_filter, map_coordinates

    zooms = [int(sys.argv[i + 1]) for i, a in enumerate(sys.argv) if a == '--zoom']
    fade, sigma = arg('--fade', 100.0), arg('--lowpass', 4.0)
    # fades are given per zoom as --corridor/--fade repeated in the same order as --zoom
    reaches = [float(sys.argv[i + 1]) for i, a in enumerate(sys.argv) if a == '--corridor']
    fades = [float(sys.argv[i + 1]) for i, a in enumerate(sys.argv) if a == '--fade'] or [fade]
    while len(fades) < len(zooms):
        fades.append(fades[-1])
    quant = arg('--quant', 256.0)  # steps per metre kept in the PNG (Terrarium holds 256)
    data = json.load(open(f'public/routes/{route_id}.json'))
    lines = [data['coords'], data.get('turnStart') or [], data.get('turnEnd') or []]
    li = data.get('leadIn')
    if li:
        lines += [li['coords'], li.get('turnStart') or []]
    src = rasterio.open(dem_path)
    A = src.read(1).astype(np.float32)
    valid = A != src.nodata if src.nodata is not None else np.isfinite(A)
    to3035 = Transformer.from_crs('EPSG:4326', src.crs, always_xy=True)
    inv = ~src.transform
    H, W = A.shape
    # distance (m) from the route and its attachments. The grid is padded: a tile that holds the route can
    # reach well past the lidar's edge, and those pixels need a distance too
    PAD = 700
    mask = np.zeros((H + 2 * PAD, W + 2 * PAD), bool)
    for pl in lines:
        if len(pl) < 2:
            continue
        xy = np.array([to3035.transform(c[0], c[1]) for c in pl])
        for a, b in zip(xy[:-1], xy[1:]):
            k = max(2, int(np.hypot(*(b - a)) / 0.5))
            t = np.linspace(0, 1, k)[:, None]
            pts = a + (b - a) * t
            cc, rr = inv * (pts[:, 0], pts[:, 1])
            ci, ri = np.floor(cc).astype(int) + PAD, np.floor(rr).astype(int) + PAD
            ok = (ci >= 0) & (ri >= 0) & (ci < W + 2 * PAD) & (ri < H + 2 * PAD)
            mask[ri[ok], ci[ok]] = True
    D = distance_transform_edt(~mask).astype(np.float32)[PAD:-PAD, PAD:-PAD]
    del mask
    # where there is no lidar, borrow the nearest ground so the filters have something to chew on
    _, (ri, ci) = distance_transform_edt(~valid, return_indices=True)
    Af = A[ri, ci]
    low = gaussian_filter(Af, sigma)
    to_src = Transformer.from_crs('EPSG:3857', src.crs, always_xy=True)
    index_path = 'public/dem/index.json'
    index = json.load(open(index_path)) if os.path.exists(index_path) else {'tiles': []}
    have = set(index['tiles'])
    for Zc, reach, fade in zip(zooms, reaches, fades):
        tile = 2 * MAXM / 2 ** Zc
        # ground metres per pixel at the route's latitude (tiles are in web mercator metres)
        lat0 = sum(c[1] for c in data['coords']) / len(data['coords'])
        px_m = tile / SIZE * math.cos(math.radians(lat0))
        Z_ = gaussian_filter(Af, 0.35 * px_m) if px_m > 1.2 else Af
        w = np.clip((reach - D) / fade, 0, 1)
        w = w * w * (3 - 2 * w)
        B = low + w * (Z_ - low)
        lons = [c[0] for pl in lines for c in pl]
        lats = [c[1] for pl in lines for c in pl]
        dlat = (reach + 5) / 111320
        dlon = (reach + 5) / (111320 * math.cos(math.radians(lat0)))
        gx0, gy0 = tile_xy_z(min(lons) - dlon, max(lats) + dlat, Zc)
        gx1, gy1 = tile_xy_z(max(lons) + dlon, min(lats) - dlat, Zc)
        count = skipped = 0
        total = 0
        for ty in range(int(gy0), int(gy1) + 1):
            for tx in range(int(gx0), int(gx1) + 1):
                mx0 = -MAXM + tx * tile
                my0 = MAXM - ty * tile
                p = (np.arange(SIZE) + 0.5) / SIZE * tile
                mx, my = np.meshgrid(mx0 + p, my0 - p)
                sx, sy = to_src.transform(mx.ravel(), my.ravel())
                cc, rr = inv * (sx, sy)
                cc = np.asarray(cc) - 0.5
                rr = np.asarray(rr) - 0.5
                inside = (cc >= 1) & (rr >= 1) & (cc < W - 2) & (rr < H - 2)
                if not inside.any():
                    continue
                cci = np.clip(cc, 0, W - 1.001)
                rri = np.clip(rr, 0, H - 1.001)
                d = map_coordinates(D, [rri, cci], order=1)
                if d[inside].min() >= reach:
                    continue
                h = map_coordinates(B, [rri, cci], order=1)
                # past the lidar's edge there is nothing true to say: pixel value 0 0 0 (-32768 m) means "no data",
                # and the engine takes the coarser tile there (src/geo/elevation.ts)
                h = np.where(inside, h, np.nan).reshape(SIZE, SIZE)
                hole = ~np.isfinite(h)
                skipped += int(hole.any())
                v = np.clip(np.rint((np.nan_to_num(h) + 32768) * quant) / quant, 1 / 256, 65535.99)
                r = np.floor(v / 256)
                g = np.floor(v - r * 256)
                b = np.floor((v - r * 256 - g) * 256 + 1e-6)
                img = np.stack([r, g, b], -1).astype(np.uint8)
                img[hole] = 0
                os.makedirs(f'public/dem/{Zc}/{tx}', exist_ok=True)
                fp = f'public/dem/{Zc}/{tx}/{ty}.png'
                Image.fromarray(img, 'RGB').save(fp, optimize=True)
                total += os.path.getsize(fp)
                have.add(f'{Zc}/{tx}/{ty}')
                count += 1
        print(f'{route_id}: z{Zc} {count} tiles ({total / 1e6:.1f} MB), {skipped} reach past the lidar edge')
    index['tiles'] = sorted(have, key=lambda t: tuple(int(v) for v in t.split('/')))
    json.dump(index, open(index_path, 'w'))


def tile_xy_z(lon, lat, z):
    k = 2 ** z
    return (lon + 180) / 360 * k, (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * k


if '--corridor' in sys.argv:
    corridor_bake()
    sys.exit(0)
Z = int(sys.argv[sys.argv.index('--zoom') + 1]) if '--zoom' in sys.argv else 15
MARGIN = float(sys.argv[sys.argv.index('--margin') + 1]) if '--margin' in sys.argv else 2500.0

coords = json.load(open(f'public/routes/{route_id}.json'))['coords']
lat0 = sum(c[1] for c in coords) / len(coords)
dlat = MARGIN / 111320
dlon = MARGIN / (111320 * math.cos(math.radians(lat0)))
s = min(c[1] for c in coords) - dlat
n = max(c[1] for c in coords) + dlat
w = min(c[0] for c in coords) - dlon
e = max(c[0] for c in coords) + dlon


def tile_xy(lon, lat):
    k = 2 ** Z
    x = (lon + 180) / 360 * k
    y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * k
    return x, y


x0, y0 = (int(v) for v in tile_xy(w, n))
x1, y1 = (int(v) for v in tile_xy(e, s))

src = rasterio.open(dem_path)
dem = src.read(1).astype(np.float32)
nodata = src.nodata
inv = ~src.transform
to_src = Transformer.from_crs('EPSG:3857', src.crs, always_xy=True)


def sample(mx, my):
    """Bilinear DEM sample at web-mercator coordinates (arrays); NaN outside."""
    sx, sy = to_src.transform(mx, my)
    col, row = inv * (sx, sy)
    col = np.asarray(col) - 0.5
    row = np.asarray(row) - 0.5
    c0 = np.floor(col).astype(int)
    r0 = np.floor(row).astype(int)
    fc = col - c0
    fr = row - r0
    H, W = dem.shape
    ok = (c0 >= 0) & (r0 >= 0) & (c0 < W - 1) & (r0 < H - 1)
    c0c = np.clip(c0, 0, W - 2)
    r0c = np.clip(r0, 0, H - 2)
    a = dem[r0c, c0c]
    b = dem[r0c, c0c + 1]
    c = dem[r0c + 1, c0c]
    d = dem[r0c + 1, c0c + 1]
    v = (a * (1 - fc) + b * fc) * (1 - fr) + (c * (1 - fc) + d * fc) * fr
    if nodata is not None:
        bad = (a == nodata) | (b == nodata) | (c == nodata) | (d == nodata)
        ok &= ~bad
    return np.where(ok, v, np.nan)


def aws_tile(x, y):
    url = f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{x}/{y}.png'
    req = urllib.request.Request(url, headers={'User-Agent': 'serpentine-bake/0.1'})
    with urllib.request.urlopen(req, timeout=30) as r:
        px = np.asarray(Image.open(r).convert('RGB')).astype(np.float32)
    return px[..., 0] * 256 + px[..., 1] + px[..., 2] / 256 - 32768


index_path = 'public/dem/index.json'
index = json.load(open(index_path)) if os.path.exists(index_path) else {'tiles': []}
have = set(index['tiles'])
count = 0
for ty in range(y0, y1 + 1):
    for tx in range(x0, x1 + 1):
        tile = 2 * MAXM / 2 ** Z
        mx0 = -MAXM + tx * tile
        my0 = MAXM - ty * tile
        px = (np.arange(SIZE) + 0.5) / SIZE * tile
        mx, my = np.meshgrid(mx0 + px, my0 - px)
        h = sample(mx.ravel(), my.ravel()).reshape(SIZE, SIZE)
        if np.isnan(h).all():
            continue
        if np.isnan(h).any():
            h = np.where(np.isnan(h), aws_tile(tx, ty), h)
        v = np.clip(h + 32768, 0, 65535.99)
        r = np.floor(v / 256)
        g = np.floor(v - r * 256)
        b = np.floor((v - r * 256 - g) * 256)
        img = np.stack([r, g, b], -1).astype(np.uint8)
        os.makedirs(f'public/dem/{Z}/{tx}', exist_ok=True)
        Image.fromarray(img, 'RGB').save(f'public/dem/{Z}/{tx}/{ty}.png', optimize=True)
        have.add(f'{Z}/{tx}/{ty}')
        count += 1
index['tiles'] = sorted(have)
json.dump(index, open(index_path, 'w'))
print(f'{route_id}: {count} tiles at z{Z} ({x1 - x0 + 1}×{y1 - y0 + 1} box), index now {len(have)} tiles')
