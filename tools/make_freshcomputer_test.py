#!/usr/bin/env python3
"""Generate testdata/9000009001/blueprint.json — the FRESH COMPUTER fixture.

Purpose (we 2026-10-28: "When I place a new minicomputer, I dont get a
xenoncode menu for the computer, and I cannot write code for it as a
consequence!"): the exact state a catalog-placed MiniComputer has —
`data: {}`, NO hdd key, NO .xc files. The v1.13.20 law: that computer IS
listed under Xenon ▾, its IDE boots a blank main.xc, and the first
authored program SAVES into the blueprint (the v1.6.1 doc-mirror class).
The listing gate + the write round-trip are vitest-pinned
(xenoncode.test.ts / xcfiles.test.ts); this fixture is the browser leg
(xenonfresh.spec.ts): menu → boot → author → save → the print runs.

Layout (identity quaternions; world = file frame):
  deck    the Buzzer Bench's slab (grounds the scene, regtest bbox)
  MiniComputer ''       (0.5, 0.25, 0)   data {} — a FRESH placement.
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
TESTDATA = os.path.join(os.path.dirname(HERE), 'testdata')


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
            "data": data if data is not None else {}, "mirrorAxis": 0,
            "occupancies": []}


def main():
    blocks = [block(x, 6, z, 0, 0, 5) for x in (3, 8) for z in (3,)]
    blocks.append(block(3, 6, 3, 5, 0, 5))
    components = [
        # THE FRESH PLACEMENT: data {} verbatim (newcraft.ts's record) —
        # no hdd key, no program field, empty alias. Nothing to list, the
        # old gate said; a programmable computer, the game says.
        comp("ARCHEAN_computer", "MiniComputer", "", 0.5, 0.25, 0, {}),
    ]
    blueprint = {
        "author": "fixture", "box_min": {"x": -1, "y": -0.5, "z": -1},
        "box_max": {"x": 2.5, "y": 2.5, "z": 2.5},
        "box_size": {"x": 3.5, "y": 3, "z": 3.5},
        "type": "Archean Build Blueprint", "version": 1,
        "datetime": "2026-10-28", "mass": 60.0, "workshop_item_id": "0000000000",
        "data": {"alias": "Fresh Computer", "version": 2, "symmetry_axis": 0,
                 "symmetry_axis_offset": 0, "indestructible": False,
                 "colors": None, "blocks": blocks, "components": components,
                 "doors": [], "frames": [], "labels": [], "pipes": [],
                 "struts": [], "triangles": []},
    }
    out_dir = os.path.join(TESTDATA, "9000009001")
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "blueprint.json"), "w") as f:
        json.dump(blueprint, f, separators=(",", ":"), ensure_ascii=False)
    print(f"wrote {out_dir}: {len(blocks)} blocks, {len(components)} comps")


main()
