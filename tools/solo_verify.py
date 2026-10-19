#!/usr/bin/env python3
"""solo_verify.py — score the solo-pair renders (app/tools/solopair.mjs).

For every reports/solo/<Type>-{dev,app}.png pair: matrix_iou-style foreground
mask (per-row modal bg), crop out each viewer's panels, bbox-normalise, IoU.
Plus the numeric check from solo.json: the per-type LOCAL bbox SPANS of the
two viewers must agree (axis signature) — a C-basis regression swaps y/z.

  python3 tools/solo_verify.py [--dir reports/solo] [--review 0.62]
"""
import argparse, json, os, sys

import numpy as np
from PIL import Image, ImageFilter

# solopair clips screenshots to the canvas rects → no panel chrome remains
CROP_DEV = (0, 0, 0, 0)
CROP_APP = (0, 0, 0, 0)


def foreground(img, crop):
    img = img.astype(np.int32)
    l, r, t, b = crop
    img = img[t:img.shape[0] - b, l:img.shape[1] - r]
    bg = np.zeros_like(img)
    for y in range(img.shape[0]):
        q = img[y] // 24
        keys = q[:, 0] * 4096 + q[:, 1] * 64 + q[:, 2]
        vals, cnts = np.unique(keys, return_counts=True)
        mc = int(vals[cnts.argmax()])
        bg[y] = ((mc // 4096) * 24, ((mc // 64) % 64) * 24, (mc % 64) * 24)
    return np.abs(img - bg).sum(axis=2) > 60


def open_mask(mask, k=5):
    im = Image.fromarray((mask * 255).astype(np.uint8))
    im = im.filter(ImageFilter.MinFilter(k)).filter(ImageFilter.MaxFilter(k))
    return np.asarray(im) > 127


def lcc(mask):
    """largest 8-connected component (matrix_iou technique): vignette edges,
    gradient bands and ground wedges are edge junk, the part is one blob."""
    small = mask[::2, ::2]
    H, W = small.shape
    seen = np.zeros_like(small)
    best, best_n = None, 0
    for sy in range(H):
        for sx in range(W):
            if not small[sy, sx] or seen[sy, sx]:
                continue
            stack, comp = [(sy, sx)], 0
            seen[sy, sx] = True
            while stack:
                y, x = stack.pop()
                comp += 1
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        ny, nx = y + dy, x + dx
                        if 0 <= ny < H and 0 <= nx < W and small[ny, nx] and not seen[ny, nx]:
                            seen[ny, nx] = True
                            stack.append((ny, nx))
            if comp > best_n:
                # re-collect the winner's pixels (cheap: mark during DFS instead)
                best_n = comp
                best_mask = np.zeros_like(small)
                # re-run fill from (sy,sx) capturing pixels
                seen2 = np.zeros_like(small)
                stack = [(sy, sx)]
                seen2[sy, sx] = True
                while stack:
                    y, x = stack.pop()
                    best_mask[y, x] = True
                    for dy in (-1, 0, 1):
                        for dx in (-1, 0, 1):
                            ny, nx = y + dy, x + dx
                            if 0 <= ny < H and 0 <= nx < W and small[ny, nx] and not seen2[ny, nx]:
                                seen2[ny, nx] = True
                                stack.append((ny, nx))
    if best_n == 0:
        return mask
    out = np.repeat(np.repeat(best_mask, 2, 0), 2, 1)[:mask.shape[0], :mask.shape[1]]
    return out & mask


def norm_mask(m, size=(160, 120)):
    ys, xs = np.where(m)
    if len(ys) == 0:
        return None
    m = m[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    im = Image.fromarray((m * 255).astype(np.uint8)).resize(size, Image.NEAREST)
    return np.asarray(im) > 127


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dir', default='reports/solo')
    ap.add_argument('--review', type=float, default=0.62)
    args = ap.parse_args()
    solo = json.load(open(os.path.join(args.dir, 'solo.json')))
    rows = []
    for r in solo:
        T = r['type']
        dp, ap_ = (os.path.join(args.dir, f'{T}-dev.png'),
                   os.path.join(args.dir, f'{T}-app.png'))
        iou = None
        if os.path.exists(dp) and os.path.exists(ap_):
            dm = norm_mask(lcc(open_mask(foreground(np.asarray(Image.open(dp).convert('RGB')), CROP_DEV))))
            am = norm_mask(lcc(open_mask(foreground(np.asarray(Image.open(ap_).convert('RGB')), CROP_APP))))
            if dm is not None and am is not None and (dm.any() and am.any()):
                iou = round(float((dm & am).sum() / (dm | am).sum()), 3)
        box_ok = None
        if isinstance(r.get('dev'), dict) and isinstance(r.get('app'), dict):
            ds = [round(r['dev']['max'][k] - r['dev']['min'][k], 1) for k in range(3)]
            as_ = [round(r['app']['max'][k] - r['app']['min'][k], 1) for k in range(3)]
            box_ok = all(abs(x - y) <= 0.12 for x, y in zip(ds, as_))
        rows.append((T, iou, box_ok))
    rows.sort(key=lambda x: (x[1] is None, x[1] if x[1] is not None else 1))
    print(f"{'type':26s} {'IoU':>6s}  local-box")
    for T, iou, bok in rows:
        flag = ''
        if iou is None: flag = ' NO-MASK'
        elif iou < args.review: flag = '  << review'
        if bok is False: flag += '  << BOX-MISMATCH'
        print(f'{T:26s} {str(iou):>6s}  {"≡" if bok else ("≠" if bok is False else "?")}{flag}')
    n_low = sum(1 for _, i, _ in rows if i is not None and i < args.review)
    n_box = sum(1 for _, _, b in rows if b is False)
    print(f'\n{len(rows)} types · {n_low} below IoU {args.review} · {n_box} local-box mismatches')
    sys.exit(1 if (n_low or n_box) else 0)


if __name__ == '__main__':
    main()
