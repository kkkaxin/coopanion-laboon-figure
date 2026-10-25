#!/usr/bin/env python3
"""Draws the closed-eye frame for Laboon from the approved front image.

    python tools/make-closed.py <pack-dir>

- starts from `laboon.png` (v0.1.1 front image) and changes ONLY the two eye areas:
  the eye oval is filled with the surrounding body colour (row-wise linear interpolation between the
  body pixels left and right of the eye, so the vertical shading carries over), then a dark navy
  ∩-shaped arc is drawn on top (middle higher, ends lower);
- everything outside the two eye ovals stays byte-identical; the script verifies that and fails if a
  pixel outside the eyes changed;
- writes `laboon-closed.png`.

Eye centres and sizes are the ones measured on `laboon.png`:
  left  (312.5, 765.0), right (711.5, 757.0), eye white ~68x94 px (canvas 1024).
Arc: span 72 px, thickness 10 px, arc height 14 px, colour = the drawing's outline navy.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

CANVAS = 1024
EYES = [  # (cx, cy, rx, ry, arc-span)
    (312.5, 765.0, 40, 52, 74),
    (711.5, 757.0, 40, 52, 74),
]
ARC_WIDTH = 11       # px at 1024
ARC_HEIGHT = 16      # px peak above the end points
SUPERSAMPLE = 4      # draw the arcs at 4x and downsample for clean edges


def outline_colour(rgb, alpha):
    """Dark navy of the drawing's own line work: median of the darkest opaque pixels."""
    mx = rgb.max(axis=2)
    mask = (alpha > ALPHA_CUT) & (mx < 80)
    if mask.sum() < 100:
        return (27, 53, 80)
    px = rgb[mask]
    return tuple(int(v) for v in np.median(px, axis=0))


ALPHA_CUT = 24


def fill_eye(rgb, alpha, cx, cy, rx, ry):
    """Fill the eye oval from the body colours just outside it, row by row."""
    h, w = alpha.shape
    x0, x1 = int(cx - rx) - 1, int(cx + rx) + 2
    y0, y1 = int(cy - ry) - 1, int(cy + ry) + 2
    x0, x1 = max(0, x0), min(w, x1)
    y0, y1 = max(0, y0), min(h, y1)
    out = rgb[y0:y1, x0:x1].copy()
    sub_alpha = alpha[y0:y1, x0:x1]
    yy, xx = np.mgrid[y0:y1, x0:x1]
    inside = ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2 <= 1.0
    painted = out.copy()
    for y in range(inside.shape[0]):
        cols = np.nonzero(inside[y])[0]
        if not len(cols):
            continue
        a, b = cols[0], cols[-1]
        lx, rx_ = max(0, a - 3), min(inside.shape[1] - 1, b + 3)
        left = out[y, lx].astype(float)
        right = out[y, rx_].astype(float)
        t = np.linspace(0, 1, b - a + 1)[:, None]
        painted[y, a:b + 1] = (left * (1 - t) + right * t).astype(np.uint8)
    rgb[y0:y1, x0:x1][inside] = painted[inside]
    alpha[y0:y1, x0:x1][inside] = 255
    return x0, y0, x1, y1


def draw_arcs(size, colour):
    """∩ arcs with round ends, drawn at SUPERSAMPLE x and downsampled."""
    s = SUPERSAMPLE
    layer = Image.new('L', (size[0] * s, size[1] * s), 0)
    d = ImageDraw.Draw(layer)
    for cx, cy, _rx, _ry, span in EYES:
        half = span / 2
        x0, y1 = cx - half, cy + ARC_HEIGHT / 2
        x1, y0 = cx + half, cy - ARC_HEIGHT / 2
        ctrl = (cx, 2 * (cy - ARC_HEIGHT / 2) - (y0 + y1) / 2)  # quadratic peak at cy - h/2
        pts = []
        for i in range(41):
            t = i / 40
            x = (1 - t) ** 2 * x0 + 2 * (1 - t) * t * ctrl[0] + t ** 2 * x1
            y = (1 - t) ** 2 * y1 + 2 * (1 - t) * t * ctrl[1] + t ** 2 * y0
            pts.append((x * s, y * s))
        d.line(pts, fill=255, width=int(ARC_WIDTH * s), joint='curve')
        for (x, y) in (pts[0], pts[-1]):  # round caps
            r = ARC_WIDTH * s / 2
            d.ellipse([x - r, y - r, x + r, y + r], fill=255)
    layer = layer.resize(size, Image.LANCZOS)
    return np.asarray(layer).astype(np.float32) / 255.0


def main():
    pack = Path(sys.argv[1])
    base = Image.open(pack / 'laboon.png').convert('RGBA')
    arr = np.asarray(base).copy()
    rgb, alpha = arr[:, :, :3].copy(), arr[:, :, 3].copy()

    colour = outline_colour(rgb, alpha)
    print('outline colour', colour)

    boxes = []
    for (cx, cy, rx, ry, _span) in EYES:
        boxes.append(fill_eye(rgb, alpha, cx, cy, rx, ry))
    arc = draw_arcs((CANVAS, CANVAS), colour)

    # composite the arc layer only inside the eye boxes (keeps the rest byte-identical)
    for (x0, y0, x1, y1) in boxes:
        a = arc[y0:y1, x0:x1, None]
        rgb[y0:y1, x0:x1] = np.clip(rgb[y0:y1, x0:x1] * (1 - a) + np.array(colour, float) * a, 0, 255)

    closed = Image.fromarray(np.dstack([rgb, alpha]).astype(np.uint8), 'RGBA')
    closed.save(pack / 'laboon-closed.png', optimize=True)

    # verification: differences only inside the eye ovals
    a0 = np.asarray(base).astype(np.int16)
    a1 = np.asarray(closed).astype(np.int16)
    diff = np.abs(a1 - a0).max(axis=2) > 0
    allowed = np.zeros(diff.shape, bool)
    yy, xx = np.mgrid[0:CANVAS, 0:CANVAS]
    for (cx, cy, rx, ry, _span) in EYES:
        allowed |= ((xx - cx) / (rx + 6)) ** 2 + ((yy - cy) / (ry + 6)) ** 2 <= 1.0
    outside = int((diff & ~allowed).sum())
    ys, xs = np.nonzero(diff)
    print('changed pixels', int(diff.sum()), 'bbox', (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())))
    print('changed outside eye ovals', outside)
    if outside:
        raise SystemExit('FAIL: pixels changed outside the eyes')
    print('ok -> laboon-closed.png')


if __name__ == '__main__':
    main()
