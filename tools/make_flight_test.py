#!/usr/bin/env python3
"""Generate the FLIGHT BENCH fixtures (v1.16.11 WP-C, workpackages: "attempt
the physics like the other tasks … figure out if a craft will fly stable,
and what its stall speed is, before we even fly it in game"):

  9000009080 FLIGHT BENCH — a textbook stable craft on the wiki's own
    criteria: a THIN BROAD wing (1 cell thick, 6 m span, 2 m chord), a
    horizontal stabilizer + vertical fin WELL BEHIND the CG, and a lead
    nose-ballast block (material 5) putting the CG clearly ahead of the
    lift centre → pitchVerdict 'stable', positive static margin, a fin
    yaw margin, a finite stall speed.

  9000009081 TAIL-HEAVY BENCH — identical airframe, the ballast moved to
    the tail: the wiki's divergent craft ("mass too far aft — pitches
    divergently") → pitchVerdict 'unstable', negative static margin. The
    discriminating pair: SAME shape, mass moved = the stability law lives
    in the CG, not the planform.

  9000009082 BRICK BENCH — a 1 m box, no thin broad section anywhere: the
    flying-brick census (S = 0, no stall speed, drag only).

Deterministic, zero components (the census reads blocks only).
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
TESTDATA = os.path.join(os.path.dirname(HERE), 'testdata')


def block(x, y, z, sx=0, sy=0, sz=0, fx=0, fy=0, fz=0, material=0):
    return {"colors": [4] * 7, "frame_x": fx, "frame_y": fy, "frame_z": fz,
            "material": material, "pos_x": x, "pos_y": y, "pos_z": z,
            "size_x": sx, "size_y": sy, "size_z": sz, "type": 0}


def craft(alias, blocks):
    xs = [c * 3 + (b["pos_x"] + b["size_x"] + 1) * 0.25
          for b in blocks for c in (b["frame_x"],)]
    return {
        "author": "flightlab", "box_min": {"x": -4, "y": -1, "z": -2},
        "box_max": {"x": 4, "y": 1, "z": 8},
        "box_size": {"x": 8, "y": 2, "z": 10},
        "type": "Archean Build Blueprint", "version": 1,
        "datetime": "2026-10-31", "mass": 0.0, "workshop_item_id": "0000000000",
        "data": {"alias": alias, "version": 2, "symmetry_axis": 0,
                 "symmetry_axis_offset": 0, "indestructible": False,
                 "colors": None, "blocks": blocks, "components": [],
                 "doors": [], "frames": [], "labels": [], "pipes": [],
                 "struts": [], "triangles": [], "composite_builds": []},
    }


def airframe(ballast_tail):
    """fuselage 2×2 cells (y 4..5) × 24 deep; wing at y-cell 7 (one cell
    BELOW the fuselage, gap y 6: clean components), z-cells 8..15, 6 m
    span; stabilizer + fin behind; ballast = a lead 2×2×3 block at the
    nose (stable) or the tail (divergent). pos ∈ 0..12 per frame."""
    blocks = [
        # fuselage: two 2×2×12 cell spans (frames z 0..1), y cells 4..5
        block(5, 4, 0, sx=1, sy=1, sz=11, fz=0),
        block(5, 4, 0, sx=1, sy=1, sz=11, fz=1),
        # wing: y-cell 7 (THIN), z-cells 8..15 (2 m chord: two frame
        # spans), x 24 cells across frames x 0..1 (6 m span)
        block(0, 7, 8, sx=11, sy=0, sz=3, fx=0, fz=0),
        block(0, 7, 0, sx=11, sy=0, sz=3, fx=0, fz=1),
        block(0, 7, 8, sx=11, sy=0, sz=3, fx=1, fz=0),
        block(0, 7, 0, sx=11, sy=0, sz=3, fx=1, fz=1),
        # horizontal stabilizer: thin, 1.75 m span, z-cells 20..22
        block(3, 7, 8, sx=6, sy=0, sz=2, fz=1),
        # vertical fin: x-cell 5 (thin in x), y-cells 9..11 (above the
        # stabilizer plane with an air gap: clean census separation),
        # z-cells 19..23
        block(5, 9, 7, sx=0, sy=2, sz=4, fz=1),
        # lead ballast (material 5 = the mass model's lead: the whole
        # discriminating pair rides on this density) — 2×2 cells = 600 kg
        block(5, 4, (8 if ballast_tail else 0), sx=1, sy=1, sz=0,
              fz=1 if ballast_tail else 0, material=5),
    ]
    return blocks


def main():
    for wid, alias, blocks in [
        ("9000009080", "Flight Bench", airframe(False)),
        ("9000009081", "Tail-Heavy Bench", airframe(True)),
        ("9000009082", "Brick Bench", [
            block(4, 4, 8, sx=3, sy=3, sz=3)]),
    ]:
        out_dir = os.path.join(TESTDATA, wid)
        os.makedirs(out_dir, exist_ok=True)
        with open(os.path.join(out_dir, "blueprint.json"), "w") as f:
            json.dump(craft(alias, blocks), f, separators=(",", ":"), ensure_ascii=False)
        print(f"wrote {out_dir}: {alias}, {len(blocks)} blocks")


if __name__ == "__main__":
    main()
