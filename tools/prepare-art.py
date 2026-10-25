#!/usr/bin/env python3
"""Turns the front (idle) and side (move) whale renders into the Laboon pack artwork.

    python tools/prepare-art.py <idle.jpg> <move.jpg> <pack-dir> <art-dir>

- white background -> transparent (soft edge, white un-blended); the faint 即梦 watermark is part of
  the background flood and disappears;
- HEAD MATCHING: the two views are scaled so the head is the same size — measured as
  (eye -> top of head) + (eye -> lower jaw), i.e. the eye sits between the two. The side view is
  limited by the canvas width, the front view is scaled down by the same ratio, so both heads match;
- 1024x1024 RGBA, each image's lowest point on the canvas bottom edge, body centre on x=512;
- prints the numbers the figure.js constants are taken from (scale, translation, extent, hits, anchors).
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

CANVAS = 1024
FIT = 0.96          # largest content side as a fraction of the canvas (the side view is width-limited)
ALPHA_CUT = 24
WHITE_TH = 236


def bg_like(a):
    mn = a.min(axis=2)
    mx = a.max(axis=2)
    return (mn >= WHITE_TH) | ((mn >= 208) & (mx - mn <= 12))


def reachable(like):
    h, w = like.shape
    r = np.zeros((h, w), bool)
    r[0] = like[0]; r[-1] = like[-1]; r[:, 0] = like[:, 0]; r[:, -1] = like[:, -1]
    while True:
        b = r.copy()
        r[1:] |= r[:-1]; r[:-1] |= r[1:]
        r[:, 1:] |= r[:, :-1]; r[:, :-1] |= r[:, 1:]
        r &= like
        if np.array_equal(r, b):
            return r


def dilate(mask, k):
    return np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(2 * k + 1))) > 127


def cutout(rgb):
    a = np.asarray(rgb).astype(np.float32)
    like = bg_like(a)
    reach = reachable(like)
    band = dilate(reach, 5) & ~reach
    dist = np.abs(a - 252.0).max(axis=2)
    soft = np.clip((dist - 5.0) / 28.0, 0, 1)
    alpha = np.ones_like(soft)
    alpha[band] = soft[band]
    alpha[reach] = 0
    al = alpha[..., None]
    safe = np.maximum(al, 0.03)
    col = (a - (1.0 - al) * 252.0) / safe
    col = np.where(al < 0.03, 0.0, np.clip(col, 0, 255))
    return Image.fromarray(np.dstack([col, alpha * 255]).astype(np.uint8), 'RGBA')


def resize_rgba(im, size):
    a = np.asarray(im).astype(np.float32)
    rgb = a[:, :, :3] * (a[:, :, 3:4] / 255.0)
    prem = Image.fromarray(np.dstack([rgb, a[:, :, 3:4]]).astype(np.uint8), 'RGBA').resize(size, Image.LANCZOS)
    b = np.asarray(prem).astype(np.float32)
    al = b[:, :, 3:4]
    rgb2 = np.where(al > 0, b[:, :, :3] * 255.0 / np.maximum(al, 1), 0)
    return Image.fromarray(np.dstack([np.clip(rgb2, 0, 255), al]).astype(np.uint8), 'RGBA')


def bbox(alpha):
    ys, xs = np.nonzero(alpha > ALPHA_CUT)
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def components(mask):
    h, w = mask.shape
    seen = np.zeros_like(mask)
    out = []
    for y in range(h):
        for x in range(w):
            if not (mask[y, x] and not seen[y, x]):
                continue
            st = [(y, x)]
            seen[y, x] = True
            pix = []
            while st:
                cy, cx = st.pop()
                pix.append((cy, cx))
                for ny, nx in ((cy + 1, cx), (cy - 1, cx), (cy, cx + 1), (cy, cx - 1)):
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        st.append((ny, nx))
            ys = np.array([p[0] for p in pix]); xs = np.array([p[1] for p in pix])
            out.append((len(pix), (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()))))
    out.sort(reverse=True)
    return out


def eye_and_jaw(rgba):
    """Eye centres (white blobs, roundish) and the lower-jaw line (the wide white tooth row)."""
    a = np.asarray(rgba)
    al = a[:, :, 3] > ALPHA_CUT
    white = al & (a[:, :, :3].min(axis=2) >= 240)
    eyes, teeth = [], None
    for area, (x0, y0, x1, y1) in components(white):
        w, h = x1 - x0 + 1, y1 - y0 + 1
        if area > 3000 and w / h < 1.6:
            eyes.append(((x0 + x1) / 2, (y0 + y1) / 2))
        elif area > 2000 and w / h > 2.2:  # tooth row under the mouth = the jaw line
            teeth = y1
    return eyes, teeth


def main():
    idle_path, move_path, pack_dir, art_dir = map(Path, sys.argv[1:5])
    rgba, boxes, eye_centres, jaw = {}, {}, {}, {}
    for key, path in (('idle', idle_path), ('move', move_path)):
        cut = cutout(Image.open(path).convert('RGB'))
        rgba[key] = cut
        cut.save(art_dir / f'{key}-cut.png')
        alpha = np.asarray(cut)[:, :, 3]
        boxes[key] = bbox(alpha)
        eyes, teeth = eye_and_jaw(cut)
        eye_centres[key] = (sum(p[0] for p in eyes) / len(eyes), sum(p[1] for p in eyes) / len(eyes))
        jaw[key] = teeth
        print(f'{key}: bbox {boxes[key]}  eye centres {eyes}  jaw y={teeth}')

    # head size: eye->top + eye->jaw
    head = {}
    for key in ('idle', 'move'):
        top = boxes[key][1]
        m_top = eye_centres[key][1] - top
        m_jaw = jaw[key] - eye_centres[key][1]
        head[key] = (m_top, m_jaw, m_top + m_jaw)
        print(f'{key}: eye->top={m_top:.1f}  eye->jaw={m_jaw:.1f}  head(h)={m_top + m_jaw:.1f}')
    ratio = head['idle'][2] / head['move'][2]
    print(f'head ratio front/side = {ratio:.4f}')

    # the side view is limited by the canvas width; the front view follows the same ratio
    move_box = boxes['move']
    s_side = FIT * CANVAS / (move_box[2] - move_box[0] + 1)
    s_front = s_side / ratio
    print(f'scale side={s_side:.4f}  front={s_front:.4f}')

    out = {}
    for key, s in (('idle', s_front), ('move', s_side)):
        cut = rgba[key]
        x0, y0, x1, y1 = boxes[key]
        tx = int(round(CANVAS / 2 - (x0 + x1) / 2 * s))
        ty = int(round(CANVAS - 1 - y1 * s))
        scaled = resize_rgba(cut, (max(8, round(cut.width * s)), max(8, round(cut.height * s))))
        canvas = Image.new('RGBA', (CANVAS, CANVAS), (0, 0, 0, 0))
        canvas.paste(scaled, (tx, ty), scaled)
        name = 'laboon.png' if key == 'idle' else 'laboon-side.png'
        canvas.save(pack_dir / name, optimize=True)
        ob = bbox(np.asarray(canvas)[:, :, 3])
        print(f'{key}: scale={s:.4f} tx={tx} ty={ty} -> {name} bbox {ob} size ({ob[2]-ob[0]+1},{ob[3]-ob[1]+1})')
        out[key] = (canvas, ob)

    # features on the new canvases
    ib = out['idle'][1]
    a = np.asarray(out['idle'][0])
    al = a[:, :, 3] > ALPHA_CUT
    white = al & (a[:, :, :3].min(axis=2) >= 240)
    eyes_c = [((b[0] + b[2]) / 2, (b[1] + b[3]) / 2) for area, b in components(white)
              if area > 1200 and (b[2] - b[0] + 1) / (b[3] - b[1] + 1) < 1.6]
    eyes_c.sort()
    gx = sum(p[0] for p in eyes_c) / len(eyes_c)
    gy = sum(p[1] for p in eyes_c) / len(eyes_c)
    print('\nidle eyes canvas', eyes_c, 'gaze', (round(gx, 1), round(gy, 1)))
    mb = out['move'][1]
    union = (min(ib[0], mb[0]), min(ib[1], mb[1] - 6), max(ib[2], mb[2]), max(ib[3], mb[3]))
    DX, DY, S = -11.5, -23.0, 279 / CANVAS
    lx = lambda x: round(DX + x * S, 1)
    ly = lambda y: round(DY + y * S, 1)
    print('union canvas bbox', union)
    print('extent logo', [lx(union[0]), ly(union[1]), lx(union[2]), ly(union[3])])
    print('gaze logo', [lx(gx), ly(gy)])
    print('idle bbox logo', [lx(ib[0]), ly(ib[1]), lx(ib[2]), ly(ib[3])])
    print('move bbox logo', [lx(mb[0]), ly(mb[1]), lx(mb[2]), ly(mb[3])])

    def circle(x0, y0, x1, y1, rf):
        return [lx((x0 + x1) / 2), ly((y0 + y1) / 2), round((min(x1 - x0, y1 - y0) / 2) * rf * S, 1)]
    print('hit idle', circle(*ib, 0.95))
    print('hit move', circle(*mb, 0.85))
    # side tail: left third of the side bbox
    tail = (mb[0], mb[1], mb[0] + (mb[2] - mb[0]) * 0.33, mb[3])
    print('hit tail', circle(*tail, 0.9))


if __name__ == '__main__':
    main()
