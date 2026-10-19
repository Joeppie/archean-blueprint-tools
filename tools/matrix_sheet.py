#!/usr/bin/env python3
"""matrix_sheet.py — visual side-by-sides + a coarse render-similarity screen.

For every matrix craft with both screenshots, build
reports/matrix/sheets/<id>.png = [ Xenon dev | our real-models ] (same
direction; framing/lighting differ by design), and a downscaled normalized
correlation over a centre crop as a FIRST-PASS screener: gross placement/
shape mismatches score low; expected stylistic differences (sky, IBL, ground
grid) keep everything below ~1 anyway. Rows flagged LOW must be eyeballed —
the metric never replaces the human diff, it only orders the queue.

  python3 tools/matrix_sheet.py [--dir reports/matrix] [--low 0.30]
"""
import argparse
import glob
import json
import os

import numpy as np
from PIL import Image

CROP = 0.62          # centre fraction compared (keeps UI chrome out)


def score(a_path, b_path):
    a, b = Image.open(a_path).convert('RGB'), Image.open(b_path).convert('RGB')
    def feat(img):
        w, h = img.size
        img = img.crop((int(w * (1 - CROP) / 2), int(h * (1 - CROP) / 2),
                        int(w * (1 + CROP) / 2), int(h * (1 + CROP) / 2)))
        img = img.resize((96, 72))
        v = np.asarray(img, dtype=np.float64)
        # silhouette energy: how far each pixel is from the local background —
        # crude but sensitive to 'the part is not there / elsewhere'
        lum = v.mean(axis=2)
        return lum
    fa, fb = feat(a), feat(b)
    fa -= fa.mean(); fb -= fb.mean()
    d = (np.linalg.norm(fa) * np.linalg.norm(fb))
    return float((fa * fb).sum() / d) if d else 0.0


def sheet(a_path, b_path, out):
    a, b = Image.open(a_path).convert('RGB'), Image.open(b_path).convert('RGB')
    h = 480
    def rs(im):
        return im.resize((int(im.width * h / im.height), h))
    a, b = rs(a), rs(b)
    gap = 8
    canvas = Image.new('RGB', (a.width + b.width + gap, h), (12, 14, 18))
    canvas.paste(a, (0, 0)); canvas.paste(b, (a.width + gap, 0))
    canvas.save(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dir', default='reports/matrix')
    ap.add_argument('--low', type=float, default=0.30)
    args = ap.parse_args()
    out_dir = os.path.join(args.dir, 'sheets')
    os.makedirs(out_dir, exist_ok=True)
    rows = []
    for dj in sorted(glob.glob(os.path.join(args.dir, '9*.json'))):
        cid = os.path.splitext(os.path.basename(dj))[0]
        dev = os.path.join(args.dir, f'{cid}-dev.png')
        ours = os.path.join(args.dir, f'{cid}-ours-real.png')
        if not (os.path.exists(dev) and os.path.exists(ours)):
            continue
        s = score(dev, ours)
        sheet(dev, ours, os.path.join(out_dir, f'{cid}.png'))
        rows.append((s, cid))
    rows.sort()
    print(f'{len(rows)} side-by-sides -> {out_dir}/')
    flagged = [r for r in rows if r[0] < args.low]
    print(f'{len(flagged)} below {args.low} (eyeball these first):')
    for s, cid in flagged:
        print(f'  {s:+.3f} {cid}')
    with open(os.path.join(args.dir, 'render-scores.json'), 'w') as f:
        json.dump(dict(rows), f, indent=1)


if __name__ == '__main__':
    main()
