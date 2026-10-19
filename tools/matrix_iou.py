#!/usr/bin/env python3
"""matrix_iou.py — framing-invariant render screen for the matrix pairs.

Both viewers frame the craft differently (the dev centers it between its
floating panels, we center the full-width canvas) and style it differently
(sky/IBL), so a raw pixel diff measures the WRONG thing. This screen:
  1. masks the FOREGROUND of each shot (pixels differing from the per-row
     modal background colour),
  2. crops to the foreground bbox and resizes both to one canonical box,
  3. IoU of the two silhouettes + bbox aspect delta.
A pair that merely frames differently scores ~0.8+; a missing part, a wrong
node placement or a mirrored pose drops the IoU hard. Scores are a QUEUE,
not a verdict — everything below --review is eyeballed on the sheet PNG.

  python3 tools/matrix_iou.py [--dir reports/matrix] [--review 0.62]
"""
import argparse
import glob
import json
import os
from collections import deque

import numpy as np
from PIL import Image, ImageFilter

# per-viewer UI chrome: dev floats ~300 px panels both sides; our viewer
# docks its 340 px DevTools panel on the RIGHT of a full-width canvas
CROP_DEV = (300, 330, 70, 80)
CROP_OURS = (25, 355, 25, 25)


def foreground(img, crop):
    l, r, t, b = crop
    img = img[t:img.shape[0] - b, l:img.shape[1] - r]
    bg = np.zeros_like(img)
    for y in range(img.shape[0]):                 # per-row modal colour
        q = img[y] // 24
        keys = q[:, 0] * 4096 + q[:, 1] * 64 + q[:, 2]
        vals, cnts = np.unique(keys, return_counts=True)
        mc = int(vals[cnts.argmax()])
        bg[y] = ((mc // 4096) * 24, ((mc // 64) % 64) * 24, (mc % 64) * 24)
    return np.abs(img - bg).sum(axis=2) > 60


def open_mask(mask, k=5):
    """Binary opening (erode→dilate) via PIL min/max filters: kills thin
    lines, label glyph strokes and grid remnants — the silhouettes that
    remain are solid part bodies. k=5 px at [::2] ≈ 10 px full-res."""
    im = Image.fromarray((mask * 255).astype(np.uint8))
    im = im.filter(ImageFilter.MinFilter(k)).filter(ImageFilter.MaxFilter(k))
    return np.asarray(im) > 127


def lcc(mask):
    """Largest 8-connected component on a 4x-downsampled mask — drops the
    small junk (label glyphs, grid remnants, page furniture) and keeps the
    dominant subject blob for the bbox-normalised IoU."""
    small = open_mask(mask)[::2, ::2]
    seen = np.zeros_like(small, dtype=bool)
    best, best_n = None, 0
    H, W = small.shape
    for sy, sx in zip(*np.nonzero(small)):
        if seen[sy, sx]:
            continue
        q = deque([(sy, sx)])
        seen[sy, sx] = True
        comp = []
        while q:
            y, x = q.popleft()
            comp.append((y, x))
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < H and 0 <= nx < W and small[ny, nx] \
                            and not seen[ny, nx]:
                        seen[ny, nx] = True
                        q.append((ny, nx))
        if len(comp) > best_n:
            best, best_n = comp, len(comp)
    if best_n < 100:                 # < ~1.6 % of a downsampled frame
        return None
    out = np.zeros_like(small)
    for y, x in best:
        out[y, x] = True
    return out


def canon(mask, size=(160, 120)):
    m = lcc(mask)
    if m is None:
        return None, None
    ys, xs = np.nonzero(m)
    box = m[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    im = Image.fromarray((box * 255).astype(np.uint8)).resize(size, Image.NEAREST)
    mm = np.asarray(im) > 127
    ar = box.shape[1] / box.shape[0]
    return mm, ar


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dir', default='reports/matrix')
    ap.add_argument('--review', type=float, default=0.62)
    args = ap.parse_args()
    rows = []
    import sys
    _djs = sorted(glob.glob(os.path.join(args.dir, '9*.json')))
    print(f'[iou] {len(_djs)} dossiers in {args.dir}', file=sys.stderr)
    for dj in _djs:
        cid = os.path.splitext(os.path.basename(dj))[0]
        dv, ou = (os.path.join(args.dir, f'{cid}{s}')
                  for s in ('-dev.png', '-ours-real.png'))
        if not (os.path.exists(dv) and os.path.exists(ou)):
            continue
        ma = canon(foreground(np.asarray(Image.open(dv).convert('RGB'),
                                         dtype=np.int16), CROP_DEV))[0]
        mb, arb = canon(foreground(np.asarray(Image.open(ou).convert('RGB'),
                                              dtype=np.int16), CROP_OURS))
        # Our viewer renders the GAME's view (z-mirror chain); the dev
        # renders raw numbers, i.e. the mirror image (FORMAT § Handeness —
        # the proven mosaic-beacon truth). At the SAME file camera direction
        # the two screens therefore relate by a horizontal flip — mirror our
        # mask to compare like-for-like. (Screenshots stay un-mirrored; this
        # is the documented expected relation, not a correction.)
        if mb is not None:
            mb = mb[:, ::-1]
        if ma is None or mb is None:
            rows.append(({'id': cid, 'iou': 0.0, 'note': 'empty-side'}))
            continue
        iou = float((ma & mb).sum() / max(1, (ma | mb).sum()))
        rows.append({'id': cid, 'iou': round(iou, 3)})
    rows.sort(key=lambda r: r['iou'])
    with open(os.path.join(args.dir, 'render-iou.json'), 'w') as f:
        json.dump(rows, f, indent=1)
    worst = [r for r in rows if r['iou'] < args.review]
    print(f'{len(rows)} pairs — median '
          f'{sorted(r["iou"] for r in rows)[len(rows)//2]:.2f} — '
          f'{len(worst)} below {args.review}:')
    for r in worst:
        print(f"  iou {r['iou']:.3f}  {r['id']}  {r.get('note', '')}")


if __name__ == '__main__':
    main()
