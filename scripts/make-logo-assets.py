#!/usr/bin/env python3
# ANTLION — Logo asset pipeline
#
# Takes upload/logo.jpg (antlion mark on solid white background) and produces:
#   public/logo.png            master transparent PNG (trimmed, padded square)
#   public/logo-96.png         small crisp version for header display
#   public/favicon-32.png      browser tab icon
#   public/apple-touch-icon.png  180x180 iOS home-screen icon (opaque, white pad)
#   public/icon-192.png        PWA-ish icon
#   public/icon-512.png        PWA-ish icon
#   public/favicon.ico         multi-size ico (16/32/48) for legacy requests
#
# Background removal strategy: FLOOD FILL from the image edges. Only the
# OUTER white background is removed — the white triangle fill inside the
# mark's dark border stays opaque (it's part of the design and keeps the
# black ant legible on dark UI backgrounds). A 2px alpha ramp softens
# JPEG anti-aliasing halos at the cut boundary.

from PIL import Image
import numpy as np
from collections import deque

SRC = "/home/z/my-project/upload/logo.jpg"
OUT = "/home/z/my-project/public"

im = Image.open(SRC).convert("RGB")
a = np.array(im).astype(np.int32)
h, w, _ = a.shape

# Distance of each pixel from pure white (0 = white)
dist = np.sqrt(((a - 255) ** 2).sum(axis=2))

NEAR = 60    # flood-fill tolerance: clearly background
SOFT = 150   # partial-alpha tolerance: anti-aliased halo

# ---- flood fill from all four edges --------------------------------------
filled = np.zeros((h, w), dtype=bool)
dq = deque()
for x in range(w):
    for y in (0, h - 1):
        if not filled[y, x] and dist[y, x] < NEAR:
            filled[y, x] = True
            dq.append((y, x))
for y in range(h):
    for x in (0, w - 1):
        if not filled[y, x] and dist[y, x] < NEAR:
            filled[y, x] = True
            dq.append((y, x))
while dq:
    y, x = dq.popleft()
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        ny, nx = y + dy, x + dx
        if 0 <= ny < h and 0 <= nx < w and not filled[ny, nx] and dist[ny, nx] < NEAR:
            filled[ny, nx] = True
            dq.append((ny, nx))

bg_ratio = filled.mean()
print(f"flood-filled background: {bg_ratio:.1%} of pixels")

alpha = np.full((h, w), 255, dtype=np.uint8)
alpha[filled] = 0

# ---- soft alpha ramp on the boundary halo --------------------------------
d = filled.copy()
for _ in range(2):
    d = d | np.roll(d, 1, 0) | np.roll(d, -1, 0) | np.roll(d, 1, 1) | np.roll(d, -1, 1)
edge = d & ~filled & (dist < SOFT)
frac = np.clip((dist - NEAR) / (SOFT - NEAR), 0, 1)
alpha[edge] = (frac[edge] * 255).astype(np.uint8)
print(f"soft-edge pixels: {int(edge.sum())}")

rgba = np.dstack([np.array(im), alpha])
out = Image.fromarray(rgba, "RGBA")

# ---- trim to content + pad to square -------------------------------------
ys, xs = np.where(alpha > 0)
if len(xs) == 0:
    raise SystemExit("logo appears fully transparent — aborting")
x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
out = out.crop((x0, y0, x1 + 1, y1 + 1))
cw, ch = out.size
side = max(cw, ch)
pad = int(side * 0.05)
canvas = Image.new("RGBA", (side + 2 * pad, side + 2 * pad), (0, 0, 0, 0))
canvas.paste(out, (pad + (side - cw) // 2, pad + (side - ch) // 2), out)
master = canvas
print(f"master: {master.size[0]}x{master.size[1]}")

# sanity: opaque-pixel share (the white triangle fill should remain)
m = np.array(master)
op = (m[:, :, 3] > 0)
print(f"opaque coverage: {op.mean():.1%}")

# ---- write sizes ----------------------------------------------------------
master.save(f"{OUT}/logo.png")

def sized(px, name, opaque_white=False, pad_frac=0.0):
    im2 = master.resize((px, px), Image.LANCZOS)
    if opaque_white:
        bg = Image.new("RGBA", (px, px), (255, 255, 255, 255))
        bg.alpha_composite(im2)
        im2 = bg
    if pad_frac > 0:
        pad = int(px * pad_frac)
        bg = Image.new("RGBA", (px, px), (0, 0, 0, 0) if not opaque_white else (255, 255, 255, 255))
        inner = px - 2 * pad
        im2 = master.resize((inner, inner), Image.LANCZOS) if pad_frac else im2
        if pad_frac:
            bg.alpha_composite(im2 if not isinstance(im2, type(master)) else im2, (pad, pad))
        im2 = bg
    im2.save(f"{OUT}/{name}")
    print(f"wrote {name} ({px}x{px})")

sized(96, "logo-96.png")
# favicon: no extra padding — mark should fill the tile for legibility at 16px
sized(32, "favicon-32.png")
sized(180, "apple-touch-icon.png", opaque_white=True)
sized(192, "icon-192.png")
sized(512, "icon-512.png")

# legacy multi-size .ico (browsers still hit /favicon.ico)
master.resize((48, 48), Image.LANCZOS).save(
    f"{OUT}/favicon.ico",
    sizes=[(16, 16), (32, 32), (48, 48)],
)
print("wrote favicon.ico (16/32/48)")

# ---- QA composite: render master on dark + light checkers -----------------
qa = Image.new("RGBA", (master.size[0] * 2 + 30, master.size[1] + 20), (0, 0, 0, 0))
dark = Image.new("RGBA", master.size, (18, 18, 22, 255))
light = Image.new("RGBA", master.size, (250, 250, 250, 255))
dark.alpha_composite(master)
light.alpha_composite(master)
qa.paste(dark, (10, 10))
qa.paste(light, (master.size[0] + 20, 10))
qa.convert("RGB").save("/home/z/my-project/scripts/logo-qa.jpg", quality=92)
print("QA composite: scripts/logo-qa.jpg")
