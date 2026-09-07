"""Generate the dashboard's facility schematic placeholder.

Brief §6: a 2.5D isometric back-of-house — security gate → receiving bay → cold rooms
→ dry store → wine/beverage store — on a **linen ground with forest/brass detailing**.
One file, swapped later for a property-accurate drawing with zero code changes.

    python -m pip install Pillow
    python scripts/make-facility-schematic.py

## What the reference is, and what this is

`stitch-export/pargolai_executive_operations_facility_hub` carries a photorealistic
cutaway 3D render as a hosted `<img>` — walls, racking, loading bays, vehicles. That
image cannot ship (§2.5: the Google-hosted URLs expire) and cannot be reproduced here.
§6 therefore asks for a *vector* of the same subject, and this is that: a cutaway
isometric plan whose rooms are told apart by their architecture rather than by a label.

The first attempt was six extruded slabs — abstract geometry that read as a diagram, not
a place, and inverted the palette by making the buildings solid forest on linen. Linen
is the ground *and* the building; forest and brass are edges, openings and fixtures.

## No text is drawn into the image

Zone names ride on the RN pins overlaid on top (`FACILITY_PINS` in
`apps/mobile/lib/facility.ts`) — baked type renders soft next to Jakarta, and a
property-accurate redraw should not have to reproduce labelling to keep the pins
meaningful. Pin anchors are printed on every run for checking against that constant.
"""

from PIL import Image, ImageDraw, ImageFilter

W, H = 1800, 720
OUT = "apps/mobile/assets/illustrations/facility-schematic.png"

LINEN_50 = (250, 249, 245)
LINEN_100 = (245, 242, 235)
LINEN_200 = (237, 232, 220)
CHAMPAGNE = (232, 227, 215)
OUTLINE = (163, 158, 147)
FOREST_900 = (8, 28, 21)
FOREST_800 = (13, 40, 24)
FOREST_700 = (20, 54, 40)
FOREST_600 = (29, 71, 54)
BRASS = (197, 160, 89)
BRASS_DARK = (154, 123, 56)

TILE = 96.0
# The squash, and it is what decides whether the drawing fills the canvas. An isometric
# diamond's width:height is 1/DEPTH, so 0.52 produced a 1.9:1 composition inside a 2.5:1
# frame — height-bound, with a third of the width left empty on both sides. 0.40 matches
# the frame, and flatter also reads more like a plan and less like a game asset.
DEPTH = 0.36
ORIGIN = [0.0, 0.0]

WALL_H = 46
COLD_H = 62
RACK_H = 34
CRATE_H = 13


def iso(gx, gy, lift=0.0):
    x = ORIGIN[0] + (gx - gy) * TILE * 0.86
    y = ORIGIN[1] + (gx + gy) * TILE * DEPTH * 0.86 - lift
    return x, y


def shade(c, f):
    return tuple(max(0, min(255, int(v * f))) for v in c)


# ---------------------------------------------------------------------------
# The plan. One building, cut away at the front so the rooms are visible.
# ---------------------------------------------------------------------------
# key, x0, y0, x1, y1 — in grid units, on a shared floor slab.
ROOMS = {
    "SEC": (0.0, 1.1, 1.5, 3.0),
    "T1_RCV": (1.9, 0.0, 4.3, 3.0),
    # Pulled apart deliberately: at a 0.2 gap their pins collided on screen and the
    # chiller's timestamp was hidden behind the freezer's card.
    "CHILL": (4.6, 0.0, 6.3, 1.15),
    "FREEZE": (4.6, 1.85, 6.3, 3.0),
    "DRY": (6.6, 0.0, 8.9, 1.6),
    "T2_DSP": (6.6, 1.8, 8.9, 3.4),
}

SLAB = (-0.3, -0.35, 9.25, 3.75)


def fit():
    xs, ys = [], []
    for x0, y0, x1, y1 in [SLAB]:
        for cx, cy in [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]:
            xs.append((cx - cy) * TILE * 0.86)
            ys.append((cx + cy) * TILE * DEPTH * 0.86)
    pad = 46
    top = min(ys) - (COLD_H + 34)
    scale = min((W - pad * 2) / (max(xs) - min(xs)), (H - pad * 2) / (max(ys) - top))
    return xs, ys, top, scale


_xs, _ys, _top, _scale = fit()
TILE *= _scale
_xs, _ys, _top, _ = fit()
ORIGIN[0] = (W - (max(_xs) - min(_xs))) / 2 - min(_xs)
ORIGIN[1] = (H - (max(_ys) - _top)) / 2 - _top

WALL_H *= _scale
COLD_H *= _scale
RACK_H *= _scale
CRATE_H *= _scale

img = Image.new("RGB", (W, H), LINEN_50)
d = ImageDraw.Draw(img, "RGBA")


def plate(x0, y0, x1, y1, fill, lift=0.0, outline=None, width=1):
    pts = [iso(x0, y0, lift), iso(x1, y0, lift), iso(x1, y1, lift), iso(x0, y1, lift)]
    d.polygon(pts, fill=fill + (255,), outline=(outline + (255,)) if outline else None, width=width)
    return pts


def wall(ax, ay, bx, by, h, face, cap=None):
    """A vertical panel from A to B, with an optional lit cap along its top edge."""
    p = [iso(ax, ay), iso(bx, by), iso(bx, by, h), iso(ax, ay, h)]
    d.polygon(p, fill=face + (255,))
    if cap:
        d.line([p[3], p[2]], fill=cap + (255,), width=2)


def box(x0, y0, x1, y1, h, top, left, right, edge=None, base=0.0):
    """An extruded block: two visible sides and a lit top.

    `base` lifts the whole block off the floor, which is what lets racking stack into
    levels instead of each tier being faked with a flat polygon.
    """
    d.polygon(
        [iso(x1, y0, base), iso(x1, y1, base), iso(x1, y1, base + h), iso(x1, y0, base + h)],
        fill=right + (255,),
    )
    d.polygon(
        [iso(x0, y1, base), iso(x1, y1, base), iso(x1, y1, base + h), iso(x0, y1, base + h)],
        fill=left + (255,),
    )
    pts = plate(x0, y0, x1, y1, top, lift=base + h)
    if edge:
        d.line([pts[3], pts[2]], fill=edge + (255,), width=2)
    return pts


# ---------------------------------------------------------------------------
# Ground, and the slab the building stands on
# ---------------------------------------------------------------------------
for i in range(-8, 22):
    d.line([iso(i, -8), iso(i, 14)], fill=CHAMPAGNE + (120,), width=1)
    d.line([iso(-8, i), iso(16, i)], fill=CHAMPAGNE + (120,), width=1)

sx0, sy0, sx1, sy1 = SLAB
PLINTH = 9 * _scale
d.polygon(
    [iso(sx1, sy0), iso(sx1, sy1), iso(sx1, sy1, -PLINTH), iso(sx1, sy0, -PLINTH)],
    fill=shade(LINEN_200, 0.80) + (255,),
)
d.polygon(
    [iso(sx0, sy1), iso(sx1, sy1), iso(sx1, sy1, -PLINTH), iso(sx0, sy1, -PLINTH)],
    fill=shade(LINEN_200, 0.72) + (255,),
)
plate(sx0, sy0, sx1, sy1, LINEN_200, outline=OUTLINE, width=1)

# The apron the flow path runs along, in front of the building.
d.line([iso(sx0 + 0.2, sy1 + 0.22), iso(sx1 - 0.2, sy1 + 0.22)], fill=BRASS + (110,), width=3)

centres = {}

# ---------------------------------------------------------------------------
# Rooms, back to front. Each is a floor, two far walls, and fixtures that say
# what the room is for.
# ---------------------------------------------------------------------------
for key in ["SEC", "T1_RCV", "CHILL", "FREEZE", "DRY", "T2_DSP"]:
    x0, y0, x1, y1 = ROOMS[key]

    floor = LINEN_100 if key not in ("CHILL", "FREEZE") else shade(LINEN_100, 0.97)
    plate(x0, y0, x1, y1, floor, outline=CHAMPAGNE)

    # The two far walls only — the near ones are cut away so the room is visible.
    wall(x0, y0, x1, y0, WALL_H, shade(LINEN_100, 0.90), cap=CHAMPAGNE)
    wall(x0, y0, x0, y1, WALL_H, shade(LINEN_100, 0.78), cap=CHAMPAGNE)

    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2

    if key == "SEC":
        # A gatehouse and a barrier: the smallest building, and the only one outside.
        box(x0 + 0.25, y0 + 0.35, x0 + 0.95, y0 + 1.05, WALL_H * 1.15,
            LINEN_100, shade(FOREST_700, 1.0), shade(FOREST_800, 1.0), edge=BRASS)
        d.line([iso(x1 - 0.15, y0 + 0.2, 20 * _scale), iso(x1 - 0.15, y1 - 0.2, 20 * _scale)],
               fill=BRASS + (230,), width=4)

    elif key == "T1_RCV":
        # Dock openings in the far wall, and pallets landed on the floor.
        for i in range(3):
            ax = x0 + 0.35 + i * 0.75
            wall(ax, y0, ax + 0.5, y0, WALL_H * 0.92, FOREST_800, cap=BRASS_DARK)
        for i in range(3):
            for j in range(2):
                px = x0 + 0.45 + i * 0.72
                py = y0 + 1.5 + j * 0.62
                box(px, py, px + 0.46, py + 0.4, CRATE_H,
                    shade(LINEN_200, 1.0), shade(LINEN_200, 0.74), shade(LINEN_200, 0.66),
                    edge=CHAMPAGNE)

    elif key in ("CHILL", "FREEZE"):
        # A sealed walk-in: linen shell, forest door, brass edging. The body stays light
        # because §6 makes linen the building and forest the detailing — two solid forest
        # blocks here were most of what made the first attempt read as the wrong palette.
        box(x0 + 0.14, y0 + 0.14, x1 - 0.14, y1 - 0.14, COLD_H,
            LINEN_100, shade(LINEN_100, 0.86), shade(LINEN_100, 0.74), edge=BRASS)
        # Insulated door on the face toward the viewer — the freezer's is the darker of
        # the two, which is the only thing distinguishing it from the chiller.
        dy0, dy1 = cy - 0.36, cy + 0.36
        d.polygon(
            [iso(x1 - 0.14, dy0), iso(x1 - 0.14, dy1),
             iso(x1 - 0.14, dy1, COLD_H * 0.78), iso(x1 - 0.14, dy0, COLD_H * 0.78)],
            fill=(FOREST_700 if key == "CHILL" else FOREST_900) + (255,),
            outline=BRASS + (220,), width=2,
        )
        # The chilling plant, sitting ON the roof — `base`, not height. Passing the roof
        # height as the block's own height drew a full-storey forest column from the
        # floor, which is what turned both walk-ins into dark towers.
        box(cx - 0.34, y0 + 0.30, cx + 0.34, y0 + 0.74, 15 * _scale,
            shade(LINEN_200, 0.98), FOREST_600, FOREST_700,
            edge=BRASS_DARK, base=COLD_H)

    elif key == "DRY":
        # Pallet racking: uprights with pallets on two levels and gaps between bays, so
        # it reads as shelving. Drawn as separate pallets rather than one long block —
        # a continuous extrusion just looked like a low wall.
        for row in range(2):
            ry = y0 + 0.42 + row * 0.66
            for bay in range(4):
                bx = x0 + 0.26 + bay * 0.52
                # Upper level first: it sits further back on screen, so painting it
                # before the lower pallet keeps the overlap the right way round.
                for base in (RACK_H * 1.25, 0.0):
                    box(bx, ry, bx + 0.40, ry + 0.26, RACK_H * 0.62,
                        shade(LINEN_200, 1.0), FOREST_600, FOREST_700,
                        edge=BRASS_DARK, base=base)

    else:  # T2_DSP
        # Staged consignments and an opening out to the apron.
        for i in range(3):
            px = x0 + 0.35 + i * 0.7
            box(px, y1 - 0.85, px + 0.5, y1 - 0.35, CRATE_H * 1.7,
                shade(LINEN_200, 1.0), shade(LINEN_200, 0.72), shade(LINEN_200, 0.64),
                edge=BRASS_DARK)
        wall(x1 - 1.1, y1, x1 - 0.2, y1, WALL_H * 0.55, FOREST_800, cap=BRASS_DARK)

    # The pin anchor: the room's centre, lifted to sit over its contents.
    px, py = iso(cx, cy, WALL_H * 0.9)
    centres[key] = (round(px / W * 1000) / 10, round(py / H * 1000) / 10)

img = img.filter(ImageFilter.SMOOTH)
img.save(OUT, optimize=True)

print(f"wrote {OUT} ({W}x{H})")
print("\nPin anchors — these must match FACILITY_PINS in apps/mobile/lib/facility.ts:")
for key, (x, y) in centres.items():
    print(f"  {key:8} x: {x}%  y: {y}%")
