#!/usr/bin/env python3
"""Generate testdata/9000009030/blueprint.json — the PANEL BENCH fixture
(v1.15.5, we: "in rcs infinity, the HUD wont run/compile, it doesnt know
set_size lives in panel? … its in the HUD documentation, can we get it
from somewhere in the game files or official documentation?" — YES: the
game's OWN wiki (wiki/en/xenoncode/hud.md, shipped in the install)
documents "$myPanel.set_size($width, $height) ; resizes the panel" plus
the .width/.height getters; RCS Infinity's guide HUD calls it live).

ONE HudController whose program:
  · creates panel(top, 100, 40) AND an always-anchored panel(top, 200, 40)
    (the SCREEN-window composition probe),
  · at tick 30 calls $p.set_size(160, 60)  — a program that could not
    PARSE before the shim member (the compile refused a legal program),
  · every tick writes "{width}x{height}" from the getters — so the panel
    pixels themselves prove the resize took (the string changes to
    "160x60" once the buffer is 160x60).

The e2e (app/e2e/xenonhud.spec.ts) asserts hud-run ON (parse+boot) and
the panel canvas at 160x60 (the resize rides the per-cycle metas).
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
TESTDATA = os.path.join(os.path.dirname(HERE), 'testdata')

HUD = """var $p = panel(top, 100, 40)
var $q = panel(top, 200, 40)
var $t = 0
var $hit = 0

tick
\t$t = $t + 1
\tif $t == 30
\t\t$p.set_size(160, 60)
\tif $t == 60
\t\t$p.set_position(400, 200)
\t$p.blank(black)
\t$p.write(1, 1, cyan, text("{0}x{1}", $p.width, $p.height))
\tif $p.button_rect(110, 40, 44, 16, green, color(30, 70, 30))
\t\t$hit = $hit + 1
\tif $hit > 0
\t\t$p.write(1, 30, white, "HIT")
\t$q.blank(black)
\t$q.write(1, 1, white, "ANCHOR")
"""

def block(x, y, z):
    return {"colors": [4] * 7, "frame_x": 0, "frame_y": 0, "frame_z": 0,
            "material": 0, "pos_x": x, "pos_y": y, "pos_z": z,
            "size_x": 0, "size_y": 0, "size_z": 0, "type": 0}

def main():
    components = [{
        "module": "ARCHEAN_hud", "type": "HudController", "alias": "bench",
        "position": {"x": 0.0, "y": 0.25, "z": 0.0},
        "orientation": {"w": 1, "x": 0, "y": 0, "z": 0},
        "colors": {"color1": {"r": 200, "g": 200, "b": 205, "a": 1},
                   "color2": {"r": 120, "g": 125, "b": 130, "a": 1}},
        "data": {"version": 1,
                 "xc_files": [{"name": "main.xc", "plain_code": HUD}]},
        "mirrorAxis": 0, "occupancies": [],
    }]
    blueprint = {
        "author": "panelbench", "box_min": {"x": -1, "y": -0.5, "z": -1},
        "box_max": {"x": 1, "y": 1, "z": 1},
        "box_size": {"x": 2, "y": 1.5, "z": 2},
        "type": "Archean Build Blueprint", "version": 1,
        "datetime": "2026-10-29", "mass": 10.0, "workshop_item_id": "0000000000",
        "data": {"alias": "Panel Bench", "version": 2, "symmetry_axis": 0,
                 "symmetry_axis_offset": 0, "indestructible": False,
                 "colors": None, "blocks": [block(3, 6, 3), block(4, 6, 3)],
                 "components": components,
                 "doors": [], "frames": [], "labels": [], "pipes": [],
                 "struts": [], "triangles": []},
    }
    out_dir = os.path.join(TESTDATA, "9000009030")
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "blueprint.json"), "w") as f:
        json.dump(blueprint, f, separators=(",", ":"), ensure_ascii=False)
    print(f"wrote {out_dir}: 1 HudController (set_size at tick 30)")

main()
