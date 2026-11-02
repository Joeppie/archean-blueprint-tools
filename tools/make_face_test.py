#!/usr/bin/env python3
"""Generate testdata/9000009020/blueprint.json — the FACE BENCH fixture
(v1.15.4, we: "THE 3D SCREEN OF COMPUTER IS MIRRORED. The normal display
we have is OK but the screen itself is MIRRORED on the component itself!").

ONE Computer component whose program paints an 'L' into the RIGHT half of
its 200x160 built-in panel (wiki: "The resolution of the integrated screen
is 200x160 pixels"). The law under test is the 3-D face mapping: viewed
from the PILOT/deck side (the side the in-game screenshots read from), the
projected ink must sit on the RIGHT (u~0.66). A mirrored face puts it on
the LEFT (u~0.34).

THE LAW (FORMAT §Computer): the Computer panel's UV is v WITH its v-axis,
u 1-MINUS (v1.13.8 in-browser ruling; v1.13.11's u-revert rendered the
readable side mirrored). v1.13.11's chair-side visibility report was
solved by DoubleSide — the u law never needed to move.

Determinism: the program repaints every update; the ink centroid is static.
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
TESTDATA = os.path.join(os.path.dirname(HERE), 'testdata')

FACE = """update
\tblank(black)
\ttext_size(3)
\twrite(120, 120, yellow, "L")
"""

def block(x, y, z, sx=0, sy=0, sz=0):
    return {"colors": [4] * 7, "frame_x": 0, "frame_y": 0, "frame_z": 0,
            "material": 0, "pos_x": x, "pos_y": y, "pos_z": z,
            "size_x": sx, "size_y": sy, "size_z": sz, "type": 0}

def comp(module, ctype, alias, x, y, z, data=None):
    return {"module": module, "type": ctype, "alias": alias,
            "position": {"x": x, "y": y, "z": z},
            "orientation": {"w": 1, "x": 0, "y": 0, "z": 0},
            "colors": {"color1": {"r": 200, "g": 200, "b": 205, "a": 1},
                       "color2": {"r": 120, "g": 125, "b": 130, "a": 1}},
            "data": data or {}, "mirrorAxis": 0, "occupancies": []}

def main():
    blocks = [block(3, 6, 3), block(4, 6, 3), block(5, 6, 3),
              block(3, 6, 4), block(4, 6, 4), block(5, 6, 4)]
    components = [
        # THE component under test: a Computer (the 200x160 built-in panel
        # + the deck; model space faces its display at the pilot side).
        comp("ARCHEAN_computer", "Computer", "face", 0.0, 0.25, 0,
             {"program": "face",
              "hdd": {"capacity": 4096, "label": "face",
                      "xc_files": [{"name": "face.main.xc", "plain_code": FACE}]}}),
    ]
    blueprint = {
        "author": "facebench", "box_min": {"x": -1, "y": -0.5, "z": -1},
        "box_max": {"x": 2, "y": 1.5, "z": 2},
        "box_size": {"x": 3, "y": 2, "z": 3},
        "type": "Archean Build Blueprint", "version": 1,
        "datetime": "2026-10-29", "mass": 25.0, "workshop_item_id": "0000000000",
        "data": {"alias": "Face Bench", "version": 2, "symmetry_axis": 0,
                 "symmetry_axis_offset": 0, "indestructible": False,
                 "colors": None, "blocks": blocks, "components": components,
                 "doors": [], "frames": [], "labels": [], "pipes": [],
                 "struts": [], "triangles": []},
    }
    out_dir = os.path.join(TESTDATA, "9000009020")
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "blueprint.json"), "w") as f:
        json.dump(blueprint, f, separators=(",", ":"), ensure_ascii=False)
    print(f"wrote {out_dir}: {len(blocks)} blocks, {len(components)} comps")

main()
