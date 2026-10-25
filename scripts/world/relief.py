"""Relief for the Serpentine Island map (docs/world/README.md), a miniature of how the game would build the land.

  node scripts/world/layout.mjs && python3 scripts/world/relief.py && node scripts/world/page.mjs

The land comes from land.py (real heights within each route's radius, the land between filled from those
edges, rough hills, rivers, the drawn coast), hillshaded and tinted here. Needs numpy and pillow. Reads
layout.json, caches DEM tiles in $WORLD_OUT/dem, writes $WORLD_OUT/relief.jpg.
"""
import os, sys
import numpy as np
from PIL import Image, ImageFilter
from land import OUT, build

land_ = build()
height, land = land_['height'], land_['land']


# hillshade (light from the northwest, heights x1.6) and tint by height, drawn at 2x
h = height.astype(np.float64)
S = 2
H = np.asarray(Image.fromarray(h.astype(np.float32)).resize((h.shape[1] * S, h.shape[0] * S), Image.BICUBIC), dtype=np.float64)
L = np.asarray(Image.fromarray(land.astype(np.uint8) * 255).resize((h.shape[1] * S, h.shape[0] * S), Image.BILINEAR), dtype=np.float64) / 255
cell = 100.0 / S
gy, gx = np.gradient(H * 1.6, cell)
az, alt = np.radians(315), np.radians(42)
slope = np.arctan(np.hypot(gx, gy))
aspect = np.arctan2(-gx, gy)
shade = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
shade = np.clip(shade, 0, 1)
stops = [(0, (86, 112, 84)), (250, (104, 124, 88)), (600, (124, 132, 92)), (1100, (132, 118, 88)),
         (1700, (128, 112, 96)), (2200, (140, 136, 130)), (2600, (214, 222, 224)), (3200, (240, 244, 245))]
def tint(z):
    out = np.zeros(z.shape + (3,))
    zs = [s[0] for s in stops]
    for c in range(3):
        out[..., c] = np.interp(z, zs, [s[1][c] for s in stops])
    return out
col = tint(H) * (0.35 + 0.95 * shade)[..., None]
# sea: deep ink, lighter over the shelf near the coast
near = np.asarray(Image.fromarray((L * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(28)), dtype=np.float64) / 255
sea = np.array([16, 38, 52]) * (1 - near[..., None] * 1.6).clip(0, 1) + np.array([38, 82, 98]) * (near[..., None] * 1.6).clip(0, 1)
img = col * L[..., None] + sea * (1 - L[..., None])
# lakes: dead flat land inside the routes' real ground
flat = np.zeros_like(H, bool)
r = 3
mx = Image.fromarray(H.astype(np.float32)).filter(ImageFilter.MaxFilter(2 * r + 1))
mn = Image.fromarray(H.astype(np.float32)).filter(ImageFilter.MinFilter(2 * r + 1))
flat = (np.asarray(mx) - np.asarray(mn) < 0.35) & (L > 0.9) & (H > 3)
fl = Image.fromarray(flat.astype(np.uint8) * 255).filter(ImageFilter.MinFilter(5)).filter(ImageFilter.MaxFilter(5))
flat = np.asarray(fl) > 0
img[flat] = [44, 92, 112]
Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(os.path.join(OUT, 'relief.jpg'), quality=86, subsampling=0)
print('wrote', os.path.join(OUT, 'relief.jpg'), file=sys.stderr)
