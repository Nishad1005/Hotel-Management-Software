"""Generate the sign-in hero placeholder.

The brief (§6) asks for "a designed placeholder: deep forest-950→900 gradient
composition with subtle brass linework — intentional, not missing-image", to be
replaced by a photograph of the property when the client supplies one. Replacing it is
dropping a new file at the same path; no code changes, which is the contract §6 sets.

This generator is committed rather than the PNG alone so the placeholder can be
remade if the palette moves. It is a build-time tool, not a dependency:

    python -m pip install Pillow
    python scripts/make-login-hero.py

The wordmark is deliberately NOT baked in. §6 mentions it, but the panel draws it as
real text over this image — so swapping in a photograph keeps the wordmark instead of
losing it and needing the code change the same paragraph forbids.
"""

import math
from PIL import Image, ImageDraw, ImageFilter

W, H = 1200, 2000
OUT = "apps/mobile/assets/illustrations/login-hero.png"

FOREST_950 = (6, 21, 16)
FOREST_900 = (8, 28, 21)
FOREST_700 = (20, 54, 40)
BRASS = (197, 160, 89)


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


base = Image.new("RGB", (W, H), FOREST_950)
px = base.load()

# A diagonal gradient rather than a vertical one: a straight vertical ramp reads as a
# UI element, a diagonal reads as light falling across a surface.
for y in range(H):
    for x in range(0, W, 4):
        t = (x / W * 0.45) + (y / H * 0.55)
        # Ease the middle so the darkest corner keeps its weight.
        t = t * t * (3 - 2 * t)
        c = lerp(FOREST_950, lerp(FOREST_900, FOREST_700, 0.35), t)
        for dx in range(4):
            if x + dx < W:
                px[x + dx, y] = c

# ---------------------------------------------------------------------------
# Brass linework, on its own layer so the whole composition can be dialled down
# at the end rather than each element being guessed at individually.
# ---------------------------------------------------------------------------
lines = Image.new("RGBA", (W, H), (0, 0, 0, 0))
d = ImageDraw.Draw(lines)

# Concentric arcs — the horology reference in DESIGN.md, struck off-centre so the
# composition has a focus without being a target.
cx, cy = W * 0.72, H * 0.30
for i, r in enumerate([260, 380, 500, 660, 840]):
    alpha = 46 - i * 6
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=BRASS + (alpha,), width=2)

# One heavier arc, drawn as a partial sweep: a complete circle is a logo, an arc is a
# drawing.
d.arc([cx - 380, cy - 380, cx + 380, cy + 380], start=205, end=340, fill=BRASS + (120,), width=3)

# A faint isometric field in the lower third — the estate-plan reference, kept well
# under the text that sits over it.
step = 96
for i in range(-H // step, (W + H) // step):
    x0 = i * step
    d.line([(x0, H), (x0 + H * 0.58, H - H * 0.58 * 1.73)], fill=BRASS + (12,), width=1)
    d.line([(W - x0, H), (W - x0 - H * 0.58, H - H * 0.58 * 1.73)], fill=BRASS + (10,), width=1)

# Two precise rules. Fine horology, ruled paper, an architect's title block.
for y, a in [(H * 0.60, 60), (H * 0.605, 22)]:
    d.line([(W * 0.10, y), (W * 0.62, y)], fill=BRASS + (a,), width=2)

lines = lines.filter(ImageFilter.GaussianBlur(0.4))
base = Image.alpha_composite(base.convert("RGBA"), lines).convert("RGB")

# ---------------------------------------------------------------------------
# Vignette, so the panel's edges stay dark and the wordmark drawn over the centre
# always has somewhere quiet to sit whatever the panel's aspect ratio crops to.
# ---------------------------------------------------------------------------
vig = Image.new("L", (W, H), 0)
vd = ImageDraw.Draw(vig)
vd.ellipse([-W * 0.35, -H * 0.12, W * 1.35, H * 1.12], fill=190)
vig = vig.filter(ImageFilter.GaussianBlur(240))
dark = Image.new("RGB", (W, H), FOREST_950)
base = Image.composite(base, Image.blend(base, dark, 0.55), vig)

base.save(OUT, optimize=True)
print(f"wrote {OUT} ({W}x{H})")
