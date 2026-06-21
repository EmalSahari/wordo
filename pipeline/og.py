#!/usr/bin/env python3
"""Generate public/og.png — the 1200x630 social share card.

Editorial light theme to match the site: paper background, big bold wordmark
with the signature orange "o", an accent rule, and a short descriptor.
Run: pipeline/.venv/bin/python pipeline/og.py
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "og.png")

# Palette (mirrors style.css :root)
PAPER = (241, 237, 227)
GLOW = (255, 246, 236)
INK = (22, 16, 9)
INK_SOFT = (77, 71, 59)
MUTED = (140, 134, 117)
LINE = (216, 209, 192)
ACCENT = (255, 90, 31)

HELV = "/System/Library/Fonts/Helvetica.ttc"
font_wordmark = ImageFont.truetype(HELV, 168, index=1)   # Bold
font_desc = ImageFont.truetype(HELV, 33, index=0)        # Regular
font_foot = ImageFont.truetype(HELV, 27, index=1)        # Bold

# ---- Background: paper + soft radial glow (top-centre) + faint grain --------
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
cx, cy = W * 0.5, H * 0.18
dist = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
glow = np.clip(1.0 - dist / 720.0, 0.0, 1.0) ** 1.6  # 0..1 falloff
base = np.array(PAPER, np.float32)
top = np.array(GLOW, np.float32)
img = base[None, None, :] + (top - base)[None, None, :] * glow[:, :, None]
rng = np.random.default_rng(7)
img += rng.normal(0, 1.6, img.shape).astype(np.float32)   # subtle paper grain
img = np.clip(img, 0, 255).astype(np.uint8)

im = Image.fromarray(img, "RGB")
d = ImageDraw.Draw(im)

# ---- Editorial hairline frame ----------------------------------------------
d.rectangle([40, 40, W - 41, H - 41], outline=LINE, width=2)

# ---- Wordmark: "Word" (ink) + "o" (accent), tight kerning, centred ---------
KERN = 10  # pull the "o" in for a tighter, grotesk-like fit
w_word = d.textlength("Word", font=font_wordmark)
w_o = d.textlength("o", font=font_wordmark)
block_w = w_word - KERN + w_o
x0 = (W - block_w) / 2
# vertical: use bbox to centre the cap height around y_center
y_center = 252
bbox = font_wordmark.getbbox("Wordo")
asc = bbox[1]
cap_h = bbox[3] - bbox[1]
y_top = y_center - cap_h / 2 - asc
d.text((x0, y_top), "Word", font=font_wordmark, fill=INK)
d.text((x0 + w_word - KERN, y_top), "o", font=font_wordmark, fill=ACCENT)

# ---- Accent rule -----------------------------------------------------------
rule_w, rule_h = 104, 9
rx = (W - rule_w) / 2
ry = 372
d.rounded_rectangle([rx, ry, rx + rule_w, ry + rule_h], radius=4, fill=ACCENT)

# ---- Descriptor ------------------------------------------------------------
desc = "Guess the word by meaning  ·  Danish & English"
dw = d.textlength(desc, font=font_desc)
d.text(((W - dw) / 2, 416), desc, font=font_desc, fill=INK_SOFT)

# ---- Footer ----------------------------------------------------------------
foot = "sahari.io"
fw = d.textlength(foot, font=font_foot)
d.text(((W - fw) / 2, 540), foot, font=font_foot, fill=ACCENT)

# Quantize to a 256-colour palette — the card is mostly flat paper + a few
# brand colours, so this is visually lossless at share sizes and ~10x smaller.
im_q = im.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG)
im_q.save(OUT, "PNG", optimize=True)
print("wrote", os.path.normpath(OUT), im.size, os.path.getsize(OUT) // 1024, "KB")
