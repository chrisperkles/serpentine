"""The Serpentine Island land builder (docs/world/README.md), shared by relief.py (the map) and bake-land.py (the game).

Island coordinates are kilometres, x east and y north, as in layout.json. A route is placed by moving it, never by
turning it: its real ground maps to the island with the engine's own transform (src/geo/mercator.ts: Web Mercator
scaled by cos(lat) of the route's first point), so a point here lands where the game puts it.

build() returns the land on a grid: real heights within each route's radius, the land between filled smoothly from
those edges (Laplace, multigrid red-black SOR), rough hills away from the routes, rivers carved, the drawn coast at
0 m. Needs numpy and pillow (scipy for bake-land.py).
"""
import json, math, os, sys, tempfile, urllib.request
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get('WORLD_OUT') or os.path.join(tempfile.gettempdir(), 'serpentine-world')
DEM = os.path.join(OUT, 'dem')
os.makedirs(DEM, exist_ok=True)
ROUTES = os.path.join(HERE, '..', '..', 'public', 'routes')
R_EARTH = 6378137.0


def layout():
    return json.load(open(os.path.join(HERE, 'layout.json')))


def route_coords(rid):
    return json.load(open(os.path.join(ROUTES, rid + '.json')))['coords']


class Placement:
    """Where a route's real ground lands on the island: mercator scaled by k = cos(lat0), moved to (ox, oy) km."""

    def __init__(self, rid, at):
        c = route_coords(rid)[0]
        self.rid, self.lon0, self.lat0 = rid, c[0], c[1]
        self.k = math.cos(math.radians(self.lat0))
        self.mx0, self.my0 = merc(self.lon0, self.lat0)
        self.ox, self.oy = at

    def to_island(self, lon, lat):
        mx, my = merc(np.asarray(lon, float), np.asarray(lat, float))
        return (mx - self.mx0) * self.k / 1000 + self.ox, (my - self.my0) * self.k / 1000 + self.oy

    def to_lonlat(self, x, y):
        mx = (np.asarray(x, float) - self.ox) * 1000 / self.k + self.mx0
        my = (np.asarray(y, float) - self.oy) * 1000 / self.k + self.my0
        return np.degrees(mx / R_EARTH), np.degrees(2 * np.arctan(np.exp(my / R_EARTH)) - math.pi / 2)


def merc(lon, lat):
    return R_EARTH * np.radians(lon), R_EARTH * np.log(np.tan(math.pi / 4 + np.radians(lat) / 2))


def placements(P=None):
    P = P or layout()
    return {rid: Placement(rid, at) for rid, at in P['routes'].items()}


def route_island(pl):
    """A route's points on the island: x, y (km), elevation, distance along (km)."""
    c = np.array([p[:3] for p in route_coords(pl.rid)], float)
    x, y = pl.to_island(c[:, 0], c[:, 1])
    d = np.concatenate([[0], np.cumsum(np.hypot(np.diff(x), np.diff(y)))])
    return np.stack([x, y, c[:, 2], d], 1)


def _tile(z, x, y):
    f = os.path.join(DEM, f'{z}_{x}_{y}.png')
    if not os.path.exists(f):
        urllib.request.urlretrieve(f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png', f)
    a = np.asarray(Image.open(f).convert('RGB'), dtype=np.float64)
    return a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768


def sample_dem(lon, lat, z):
    """Bilinear Terrarium heights (AWS Terrain Tiles) at zoom z."""
    if lon.size == 0:
        return np.zeros(0)
    n = 2 ** z
    fx = (lon + 180) / 360 * n
    fy = (1 - np.log(np.tan(np.radians(lat)) + 1 / np.cos(np.radians(lat))) / math.pi) / 2 * n
    tx0, tx1, ty0, ty1 = int(fx.min()), int(fx.max()), int(fy.min()), int(fy.max())
    mos = np.block([[_tile(z, x, y) for x in range(tx0, tx1 + 1)] for y in range(ty0, ty1 + 1)])
    px, py = (fx - tx0) * 256 - 0.5, (fy - ty0) * 256 - 0.5
    x0 = np.clip(np.floor(px).astype(int), 0, mos.shape[1] - 2)
    y0 = np.clip(np.floor(py).astype(int), 0, mos.shape[0] - 2)
    ax, ay = np.clip(px - x0, 0, 1), np.clip(py - y0, 0, 1)
    return (mos[y0, x0] * (1 - ax) * (1 - ay) + mos[y0, x0 + 1] * ax * (1 - ay)
            + mos[y0 + 1, x0] * (1 - ax) * ay + mos[y0 + 1, x0 + 1] * ax * ay)


def dist_to(pts, X, Y):
    d = np.full(X.shape, 1e9)
    for i in range(0, len(pts), 200):
        chunk = pts[i:i + 200]
        dd = np.sqrt((X[..., None] - chunk[:, 0]) ** 2 + (Y[..., None] - chunk[:, 1]) ** 2).min(-1)
        d = np.minimum(d, dd)
    return d


def resample(pts, step):
    out = [list(pts[0])]
    for p in pts[1:]:
        q = out[-1]
        n = int(math.hypot(p[0] - q[0], p[1] - q[1]) / step)
        for k in range(1, n + 1):
            out.append([q[0] + (p[0] - q[0]) * k / (n + 1), q[1] + (p[1] - q[1]) * k / (n + 1)] + list(p[2:]))
        out.append(list(p))
    return out


def _relax(u, fx, fv, it):
    # red-black SOR: each colour sees the other's fresh values, so over-relaxation stays stable
    ii, jj = np.indices(u.shape)
    colours = [((ii + jj) % 2 == c) & ~fx for c in (0, 1)]
    u = np.where(fx, fv, u)
    for _ in range(it):
        for c in colours:
            n = np.pad(u, 1, mode='edge')
            avg = (n[:-2, 1:-1] + n[2:, 1:-1] + n[1:-1, :-2] + n[1:-1, 2:]) / 4
            u = np.where(c, u + 1.85 * (avg - u), u)
    return u


def _down(a, f, how):
    h, w = a.shape[0] // f * f, a.shape[1] // f * f
    b = a[:h, :w].reshape(h // f, f, w // f, f)
    return b.max(axis=(1, 3)) if how == 'any' else b.mean(axis=(1, 3))


def _noise(shape, octaves, seed):
    rng = np.random.default_rng(seed)
    ny, nx = shape
    out = np.zeros(shape)
    for octave, amp in octaves:
        r_ = rng.standard_normal((ny // octave + 2, nx // octave + 2)).astype(np.float32)
        out += amp * np.asarray(Image.fromarray(r_).resize((nx + octave * 2, ny + octave * 2), Image.BICUBIC))[:ny, :nx]
    return out


def _blur(a, r):
    k = np.ones(2 * r + 1) / (2 * r + 1)
    for ax in (0, 1):
        a = np.apply_along_axis(lambda v: np.convolve(np.pad(v, r, mode='edge'), k, mode='valid'), ax, a)
    return a


def build(res=0.1, bounds=(0.0, 90.0, 6.0, 76.0), z=11, P=None, world=None, log=sys.stderr):
    """The land on a grid of `res` km over bounds (x0, x1, y0, y1), real ground from DEM zoom z. Its noise is drawn
    per grid, so the whole island is built once at 100 m (the game's fill) and finer work samples that.

    Returns a dict of arrays (row 0 = north): height (m, sea floor below 0), land (bool), real (m, real ground
    where weight > 0), weight (0..1, how much is real ground), rough (amplitude of the invented hills, m),
    plus the grid's x and y centres.
    """
    P = P or layout()
    X0, X1, Y0, Y1 = bounds
    NX, NY = int(round((X1 - X0) / res)), int(round((Y1 - Y0) / res))
    gx = X0 + (np.arange(NX) + 0.5) * res
    gy = Y1 - (np.arange(NY) + 0.5) * res
    GX, GY = np.meshgrid(gx, gy)
    pls = placements(P)
    world = world or {rid: route_island(pl) for rid, pl in pls.items()}
    # the land fill reaches far; routes well outside the bounds still shape it at the edges
    margin = 12.0

    num = np.zeros((NY, NX)); den = np.zeros((NY, NX)); wmax = np.zeros((NY, NX))
    sea_core = np.zeros((NY, NX), bool)
    for rid, pl in pls.items():
        core, feather = P['radius'].get(rid, P['radius']['default'])
        pts = world[rid][::2, :2]
        if pts[:, 0].max() + feather < X0 - margin or pts[:, 0].min() - feather > X1 + margin:
            continue
        if pts[:, 1].max() + feather < Y0 - margin or pts[:, 1].min() - feather > Y1 + margin:
            continue
        i0 = max(0, int((Y1 - (pts[:, 1].max() + feather)) / res)); i1 = min(NY, int((Y1 - (pts[:, 1].min() - feather)) / res) + 1)
        j0 = max(0, int((pts[:, 0].min() - feather - X0) / res)); j1 = min(NX, int((pts[:, 0].max() + feather - X0) / res) + 1)
        if i1 <= i0 or j1 <= j0:
            continue
        Xs, Ys = GX[i0:i1, j0:j1], GY[i0:i1, j0:j1]
        d = dist_to(pts, Xs, Ys)
        w = np.clip((feather - d) / (feather - core), 0, 1)
        w = w * w * (3 - 2 * w)
        m = w > 0
        lon, lat = pl.to_lonlat(Xs[m], Ys[m])
        h = np.zeros(Xs.shape); h[m] = sample_dem(lon, lat, z)
        num[i0:i1, j0:j1] += w * h; den[i0:i1, j0:j1] += w
        wmax[i0:i1, j0:j1] = np.maximum(wmax[i0:i1, j0:j1], w)
        sea_core[i0:i1, j0:j1] |= (w > 0.5) & (h <= 0.5)
        print(rid, 'ok', file=log)
    real = np.where(den > 0, num / np.maximum(den, 1e-9), 0)

    # land: the drawn coast, except where a coastal route's own real sea is
    img = Image.new('L', (NX, NY), 0)
    ImageDraw.Draw(img).polygon([((x - X0) / res, (Y1 - y) / res) for x, y in P['coast']], fill=255)
    poly = np.asarray(img.filter(ImageFilter.GaussianBlur(0.9 / res)), dtype=float) / 255
    # coastline wiggle (4.8, 1.6 and 0.6 km)
    oc = lambda km: max(1, int(round(km / res)))
    cn = _noise((NY, NX), [(oc(4.8), 0.5), (oc(1.6), 0.3), (oc(0.6), 0.2)], 3)
    land = (poly + 0.22 * cn > 0.5) | ((wmax > 0.5) & ~sea_core)
    land &= ~sea_core

    # rivers outside the routes: fixed heights along the line
    riv = np.full((NY, NX), np.nan)
    for rv in P['rivers']:
        for x, y, h in resample(rv['pts'], res * 0.5):
            i, j = int((Y1 - y) / res), int((x - X0) / res)
            for di in (-1, 0, 1):
                for dj in (-1, 0, 1):
                    if 0 <= i + di < NY and 0 <= j + dj < NX and wmax[i + di, j + dj] < 0.01:
                        riv[i + di, j + dj] = h

    fixed = (wmax >= 0.999) | ~land | ~np.isnan(riv)
    val = np.where(wmax >= 0.999, real, 0.0)
    val = np.where(~np.isnan(riv), riv, val)
    val = np.where(~land, 0.0, val)
    u = None
    for f in (16, 8, 4, 2, 1):
        fx = _down(fixed.astype(float), f, 'any') > 0 if f > 1 else fixed
        fv = (_down(np.where(fixed, val, 0), f, 'mean') / np.maximum(_down(fixed.astype(float), f, 'mean'), 1e-9)) if f > 1 else val
        if u is None:
            u = np.where(fx, fv, fv[fx].mean() if fx.any() else 0)
        else:
            u = np.asarray(Image.fromarray(u.astype(np.float32)).resize((fx.shape[1], fx.shape[0]), Image.BILINEAR), dtype=np.float64)
        u = _relax(u, fx, fv, 400 if f > 2 else 250)
    fill = np.zeros((NY, NX)); fill[:u.shape[0], :u.shape[1]] = u

    # rough country away from the routes and the coast
    noise = _noise((NY, NX), [(oc(12.8), 1.3), (oc(6.4), 0.9), (oc(3.2), 0.45), (oc(1.6), 0.22), (oc(0.8), 0.1)], 7)
    ridge = 1 - np.abs(noise / 1.4)
    allpts = np.array([p for rid in pls for p in resample(world[rid][::6, :2].tolist(), 0.3)])
    cg = max(1, int(round(0.5 / res)))
    dr = dist_to(allpts, GX[::cg, ::cg], GY[::cg, ::cg])
    dr = np.asarray(Image.fromarray(dr.astype(np.float32)).resize((NX, NY), Image.BICUBIC))
    coast_d = np.asarray(Image.fromarray((~land).astype(np.uint8) * 255).filter(ImageFilter.GaussianBlur(2.5 / res)), dtype=float) / 255
    amp = np.clip((dr - 1.5) / 4, 0, 1) * (90 + 0.45 * np.maximum(fill, 0)) * np.clip(1 - coast_d * 2.2, 0, 1)
    rivpts = np.array([p[:2] for rv in P['rivers'] for p in resample(rv['pts'], 0.3)])
    drv = np.asarray(Image.fromarray(dist_to(rivpts, GX[::cg, ::cg], GY[::cg, ::cg]).astype(np.float32)).resize((NX, NY), Image.BICUBIC))
    amp *= np.clip((drv - 0.3) / 1.5, 0, 1)
    amp = _blur(_blur(amp, max(1, int(0.4 / res))), max(1, int(0.4 / res)))
    rough = fill + amp * (ridge - 0.45) * 1.6
    height = np.where(wmax >= 0.999, real, wmax * real + (1 - wmax) * rough)
    height = np.where(~np.isnan(riv), riv, height)
    height = np.where(land, np.maximum(height, 2), -20 - 80 * coast_d)
    print('height', round(float(height[land].min())) if land.any() else 0, round(float(height.max())), file=log)
    return dict(height=height, land=land, real=real, weight=wmax, rough=amp, fill=fill, gx=gx, gy=gy, res=res, bounds=bounds)
