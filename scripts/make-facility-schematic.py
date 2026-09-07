"""Generate the dashboard's facility schematic placeholder.

Brief §6: a 2.5D isometric back-of-house — security gate → receiving bay → cold rooms
→ dry store → beverage store — on a linen ground with forest/brass detailing. One file,
swapped later for a property-accurate drawing with zero code changes.

    python -m pip install Pillow
    python scripts/make-facility-schematic.py

**No text is drawn into the image.** Zone names ride on the RN pins overlaid on top
(`FACILITY_PINS` in `apps/mobile/lib/facility.ts`), for two reasons: baked type at this
scale renders soft next to Jakarta, and a property-accurate redraw should not have to
reproduce the labelling to keep the pins meaningful. The asset is geometry; the words
and every number are real data drawn by the app.

Pin anchors are percentages of this canvas and are duplicated in that TS constant —
the two must agree, so the zone centres are computed here from one table and printed on
generation for checking against it.
"""

import math
from PIL import Image, ImageDraw, ImageFilter

W, H = 1800, 720
OUT = "apps/mobile/assets/illustrations/facility-schematic.png"

LINEN_50 = (250, 249, 245)
LINEN_100 = (245, 242, 235)
CHAMPAGNE = (232, 227, 215)
FOREST_900 = (8, 28, 21)
FOREST_800 = (13, 40, 24)
FOREST_700 = (20, 54, 40)
FOREST_600 = (29, 71, 54)
BRASS = (197, 160, 89)
BRASS_DARK = (154, 123, 56)

# Isometric projection: a tile of (w, d) at grid (gx, gy) with a height h.
TILE = 118
DEPTH = 0.5  # vertical squash — a flatter angle reads as a plan, not a video game

# key, grid x, grid y, footprint (cols, rows), extrusion height, fill
#
# Laid out as a flow left to right — gate, bay, then the stores branching off it — so the
# projection spreads across a 16:9 canvas rather than stacking into a diamond.
ZONES = [
    ("SEC", 0.0, 0.2, (1.0, 1.3), 30, FOREST_700),
    ("T1_RCV", 1.6, 0.0, (1.7, 1.7), 46, FOREST_800),
    ("CHILL", 3.8, -1.1, (1.4, 1.3), 78, FOREST_600),
    ("FREEZE", 3.8, 0.9, (1.4, 1.3), 78, FOREST_600),
    ("DRY", 5.9, -0.4, (1.7, 1.8), 60, FOREST_800),
    ("T2_DSP", 7.9, 0.6, (1.3, 1.4), 34, FOREST_700),
]

# Filled in below, once the composition's true extent is known.
ORIGIN = [0.0, 0.0]


def iso(gx, gy):
    """Grid coordinates to canvas pixels."""
    x = ORIGIN[0] + (gx - gy) * TILE * 0.86
    y = ORIGIN[1] + (gx + gy) * TILE * DEPTH * 0.86
    return x, y


def fit():
    """Centre the composition on the canvas.

    Hand-picked origins are how the first attempt put the security gate off the left
    edge with a third of the canvas empty on the right. Measuring the drawing and
    centring it means the layout above can be rearranged without re-guessing.
    """
    xs, ys = [], []
    for _key, gx, gy, (cols, rows), height, _fill in ZONES:
        for cx, cy in [(gx, gy), (gx + cols, gy), (gx + cols, gy + rows), (gx, gy + rows)]:
            x = (cx - cy) * TILE * 0.86
            y = (cx + cy) * TILE * DEPTH * 0.86
            xs += [x]
            ys += [y - height, y]
    pad = 90
    scale = min((W - pad * 2) / (max(xs) - min(xs)), (H - pad * 2) / (max(ys) - min(ys)))
    return xs, ys, scale


def top_face(gx, gy, cols, rows):
    return [iso(gx, gy), iso(gx + cols, gy), iso(gx + cols, gy + rows), iso(gx, gy + rows)]


# Measure, scale the tile to fit, then measure again with that tile and centre.
_xs, _ys, _scale = fit()
TILE = TILE * _scale
_xs, _ys, _ = fit()
ORIGIN[0] = (W - (max(_xs) - min(_xs))) / 2 - min(_xs)
ORIGIN[1] = (H - (max(_ys) - min(_ys))) / 2 - min(_ys)

img = Image.new("RGB", (W, H), LINEN_50)
d = ImageDraw.Draw(img, "RGBA")

# A faint isometric grid, so the plates sit on a surface rather than float.
for i in range(-6, 16):
    d.line([iso(i, -4), iso(i, 12)], fill=CHAMPAGNE + (150,), width=1)
    d.line([iso(-4, i), iso(14, i)], fill=CHAMPAGNE + (150,), width=1)

# The flow path — gate to dispatch, the spine the whole product is about. Drawn on the
# ground before the plates, so it passes behind them and shows in the gaps between.
path = [
    iso(0.5, 1.7),
    iso(2.4, 1.9),
    iso(4.5, 2.4),
    iso(6.7, 1.6),
    iso(8.5, 2.1),
]
for i in range(len(path) - 1):
    d.line([path[i], path[i + 1]], fill=BRASS + (90,), width=3)
for pt in path:
    d.ellipse([pt[0] - 5, pt[1] - 5, pt[0] + 5, pt[1] + 5], fill=BRASS + (150,))

centres = {}

# Painter's order: far plates first, so nearer extrusions overlap correctly.
for key, gx, gy, (cols, rows), height, fill in sorted(ZONES, key=lambda z: z[1] + z[2]):
    top = top_face(gx, gy, cols, rows)
    lifted = [(x, y - height) for x, y in top]

    # Left and right walls.
    d.polygon([top[3], top[2], lifted[2], lifted[3]], fill=FOREST_900 + (255,))
    d.polygon([top[0], top[3], lifted[3], lifted[0]], fill=tuple(int(c * 0.72) for c in fill) + (255,))
    # The lit top plate.
    d.polygon(lifted, fill=fill + (255,), outline=BRASS_DARK + (120,))

    # A brass edge on the leading rim only — a full outline reads as a wireframe.
    d.line([lifted[3], lifted[2]], fill=BRASS + (160,), width=2)

    cx = sum(p[0] for p in lifted) / 4
    cy = sum(p[1] for p in lifted) / 4
    centres[key] = (round(cx / W * 1000) / 10, round(cy / H * 1000) / 10)

img = img.filter(ImageFilter.SMOOTH)
img.save(OUT, optimize=True)

print(f"wrote {OUT} ({W}x{H})")
print("\nPin anchors — these must match FACILITY_PINS in apps/mobile/lib/facility.ts:")
for key, (x, y) in centres.items():
    print(f"  {key:8} x: {x}%  y: {y}%")
