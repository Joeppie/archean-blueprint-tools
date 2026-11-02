#!/usr/bin/env python3
"""Lean the PilotSeat forward and shift it toward the tail in blueprint.json.

Format facts this relies on (verified, see FORMAT.md):
  - 1 grid cell = 0.25 m, pos_* in 0..12, frame_* = multiples of 12 cells (3 m).
  - world = (pos - 5.5)*0.25 + frame*3.0; -z is the nose, +z the tail.
  - PilotSeat.pivot = components[13].position; orientation is a Unity quaternion
    {w,x,y,z}; rotation about +X by theta tips the seatback toward +z (tail),
    so a *negative* theta leans it forward toward the nose.
  - Each component occupancy has a mirrored type-255 entry in data.blocks;
    shift both together.

Usage:  python3 adjust_seat.py            # dry-run, prints planned changes
        python3 adjust_seat.py --apply    # write blueprint.json (keeps .bak)
        python3 adjust_seat.py --pitch 15 --shift 0.5   # customise (deg, metres)
"""
import argparse
import json
import math
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).parent


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("bp", nargs="?", default="blueprint.json",
                    help="path to a blueprint.json (default: ./blueprint.json)")
    ap.add_argument("--apply", action="store_true", help="write changes to blueprint.json")
    ap.add_argument("--pitch", type=float, default=12.0,
                    help="forward lean in degrees (0 = upright, positive = lean nose-ward)")
    ap.add_argument("--shift", type=float, default=0.25,
                    help="metres to move toward the tail (+z), snapped to 0.25 m grid")
    args = ap.parse_args()
    BP = Path(args.bp)
    BAK = BP.with_name(BP.stem + "_bak.json")

    raw = BP.read_bytes()
    bp = json.loads(raw)
    comps = bp["data"]["components"]
    blocks = bp["data"]["blocks"]

    seat = next(c for c in comps if c["type"] == "PilotSeat")
    occ = seat["occupancies"][0]

    cells = round(args.shift / 0.25)
    dpos = cells * 0.25
    theta = -math.radians(args.pitch)          # negative about +X = forward lean
    q = {"w": math.cos(theta / 2), "x": math.sin(theta / 2), "y": 0.0, "z": 0.0}

    # mirror record in data.blocks: type 255 with identical frame/pos/size
    def same(a):
        return (a["type"] == 255 and all(a[k] == occ[k] for k in
                ("frame_x", "frame_y", "frame_z", "pos_x", "pos_y", "pos_z",
                 "size_x", "size_y", "size_z")))
    mirrors = [b for b in blocks if same(b)]
    if len(mirrors) != 1:
        sys.exit(f"expected exactly 1 type-255 mirror of the seat occupancy, found {len(mirrors)}")
    mirror = mirrors[0]

    print(f"seat: position z {seat['position']['z']:.4f} -> {seat['position']['z'] + dpos:.4f} "
          f"({'+' if dpos >= 0 else ''}{dpos} m toward tail)")
    print(f"seat: orientation identity -> pitch {args.pitch:.1f}° forward "
          f"(q w={q['w']:.6f} x={q['x']:.6f})")
    print(f"grid: pos_z {occ['pos_z']}..{occ['pos_z'] + occ['size_z']} -> "
          f"{occ['pos_z'] + cells}..{occ['pos_z'] + occ['size_z'] + cells} (x2: occupancies + blocks mirror)")

    # apply
    seat["position"]["z"] = seat["position"]["z"] + dpos
    seat["orientation"] = q
    occ["pos_z"] += cells
    mirror["pos_z"] += cells

    out = json.dumps(bp, separators=(",", ":"), ensure_ascii=False).encode("utf-8")

    # safety: everything except the fields we touched must survive byte-identical
    check = json.loads(out)
    assert check["data"]["components"][13]["type"] == "PilotSeat"
    assert check["mass"] == bp["mass"] and check["box_max"] == bp["box_max"]
    n_changed = sum(1 for a, b in zip(raw.decode("utf-8"), out.decode("utf-8")) if a != b) \
        if len(raw) == len(out) else "len " + str(len(raw)) + " -> " + str(len(out))
    print(f"serialization: {len(out)} bytes (was {len(raw)}); char diffs: {n_changed}")

    if not args.apply:
        print("dry-run, nothing written (use --apply)")
        return
    if not BAK.exists():
        shutil.copy2(BP, BAK)
        print(f"backup written: {BAK.name}")
    BP.write_bytes(out)
    print(f"applied: {BP.name} updated")


if __name__ == "__main__":
    main()
