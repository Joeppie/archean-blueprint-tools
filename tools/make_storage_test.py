#!/usr/bin/env python3
"""Generate testdata/9000009096/blueprint.json — the STORAGE BENCH fixture
(v1.16.27, we: "I tried the chipOS devkt, but all screens say to use the
primary one and I cannot get it to work. I suspect something is wrong there").

ONE MiniComputer whose program counts BOOTS in a `storage var` and mirrors
it onto the bus row "bootcount". In-game a storage var survives beside the
save; our wasm VM runs on an in-memory FS that dies with the page, so
without the persistence law (xenonstore.ts + shim ABI 19 seed/dump) the
count resets to 1 on every page load. The e2e reloads the page and asserts
the row INCREASES — the whole persistence law, one number, one craft.

The two-branch increment keeps the fixture honest: a first boot (empty
storage) writes 1, every restored boot adds one.
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
TESTDATA = os.path.join(os.path.dirname(HERE), 'testdata')

BOOTCOUNTER = """storage var $boots : number
var $reported = 0

update
\tif $reported == 0
\t\tif $boots == 0
\t\t\t$boots = 1
\t\telse
\t\t\t$boots = $boots + 1
\t\t$reported = 1
\toutput_number("bootcount", 0, $boots)
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
    blocks = [block(3, 6, 3, 5, 0, 5)]
    components = [
        comp("ARCHEAN_computer", "MiniComputer", "bootcounter", 0.5, 0.25, 0,
             {"program": "bootcounter",
              "hdd": {"capacity": 4096, "label": "bootcounter",
                      "xc_files": [{"name": "bootcounter.main.xc",
                                    "plain_code": BOOTCOUNTER}]}}),
    ]
    blueprint = {
        "author": "storage", "box_min": {"x": -1.5, "y": -0.5, "z": -1.5},
        "box_max": {"x": 2.5, "y": 2.5, "z": 2.5},
        "box_size": {"x": 4, "y": 3, "z": 4},
        "type": "Archean Build Blueprint", "version": 1,
        "datetime": "2026-11-01", "mass": 80.0, "workshop_item_id": "0000000000",
        "data": {"alias": "Storage Bench", "version": 2, "symmetry_axis": 0,
                 "symmetry_axis_offset": 0, "indestructible": False,
                 "colors": None, "blocks": blocks, "components": components,
                 "doors": [], "frames": [], "labels": [], "pipes": [],
                 "struts": [], "triangles": []},
    }
    out_dir = os.path.join(TESTDATA, "9000009096")
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "blueprint.json"), "w") as f:
        json.dump(blueprint, f, separators=(",", ":"), ensure_ascii=False)
    print(f"wrote {out_dir}: {len(blocks)} blocks, {len(components)} comps")


main()
