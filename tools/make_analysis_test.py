#!/usr/bin/env python3
"""Generate testdata/9000009090/blueprint.json — the ANALYSIS BENCH
(v1.16.13, the user: "I want better xenoncode analysis. Report missing
functions, definitions, missing return statements in functions where a
result is used, etc. … mark them like VS would").

ONE MiniComputer disk carries EXACTLY ONE deliberate defect per analyzer
code (engine/xcanalyze.ts) so the pins are discriminating:

  unknown-include     include "missing.xc"
  duplicate-var       var $v twice (global)
  unused-var          var $dead
  duplicate-function  function @dup declared twice
  missing-return      @silent declares : number, no return, result used
  unused-function     @never_called
  unused-param        @sink's $p never used in the body
  undeclared-function @no_such(1)
  unknown-function    made_up(2)
  unknown-method      $s.bogus(1)
  unknown-alias       input_number("ghost", 0)  (the craft has 'lamp')

and the CLEAN counterparts: @dup/@sink are called, $v/$x are read,
input_number("lamp", 0) names the wired ToggleButton — none of those may
diagnose (the true-negative half of the pair).
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
TESTDATA = os.path.join(os.path.dirname(HERE), 'testdata')

PROGRAM = """include "missing.xc"

var $v = 1
var $v = 2
var $dead = 3

function @dup($p : number)
\tprint($p)

function @dup($p : number)
\tprint($p)

function @silent() : number
\tprint(1)

function @never_called()
\tprint(2)

function @sink($p : number)
\tprint(3)

var $x = 0

init
\t@dup(1)
\t@sink(2)
\t$x = @silent()
\t@no_such(1)
\tprint(made_up(2))
\tvar $s = screen(1, 0)
\t$s.bogus(1)
\tprint(input_number("ghost", 0))
\tprint(input_number("lamp", 0))

update
\tprint($x + $v)
"""


def block(x, y, z, sx=0, sy=0, sz=0, material=0):
    return {"colors": [4] * 7, "frame_x": 0, "frame_y": 0, "frame_z": 0,
            "material": material, "pos_x": x, "pos_y": y, "pos_z": z,
            "size_x": sx, "size_y": sy, "size_z": sz, "type": 0}


def comp(module, ctype, alias, x, y, z, data=None):
    return {"module": module, "type": ctype, "alias": alias,
            "position": {"x": x, "y": y, "z": z},
            "orientation": {"w": 1, "x": 0, "y": 0, "z": 0},
            "colors": {"color1": {"r": 200, "g": 200, "b": 205, "a": 1},
                       "color2": {"r": 120, "g": 125, "b": 130, "a": 1}},
            "data": data or {}, "mirrorAxis": 0, "occupancies": []}


def pipe(ac, ap, bc, bp, kind):
    return {"a_component": ac, "a_port": ap, "b_component": bc, "b_port": bp,
            "type": kind, "radius": 0.02, "flexible": False,
            "segments": [{"a": 255, "b": 255, "box": False, "chrome": False,
                          "dir": 3, "flexible": False, "g": 255, "glossy": False,
                          "length": 0.25, "metal": False, "r": 255,
                          "rounded_caps": True, "striped": False,
                          "start": {"x": 0.0, "y": 0.5, "z": 0.5}}]}


def main():
    blocks = [block(4, 6, 4, sx=4, sy=0, sz=4)]
    components = [
        comp("ARCHEAN_hid", "ToggleButton", "lamp", 0.0, 1.5, 0.0,
             {"state": False, "onValue": 1.0, "offValue": 0.0}),
        comp("ARCHEAN_computer", "MiniComputer", "analyst", 1.0, 1.75, 0.0,
             {"program": "main",
              "hdd": {"capacity": 8192, "label": "bench",
                      "xc_files": [{"name": "main.xc", "plain_code": PROGRAM}]}}),
        comp("ARCHEAN_battery", "LowVoltageBattery", "cell", -1.0, 1.5, 0.0),
    ]
    cpu = 1
    pipes = [
        pipe(2, "connector.000", cpu, "power_connector", "lowvoltage"),
        pipe(cpu, "data_port.000", 0, "data", "data"),
    ]
    blueprint = {
        "author": "analysis", "box_min": {"x": -1.5, "y": 1.0, "z": -0.5},
        "box_max": {"x": 1.5, "y": 2.0, "z": 1.5},
        "box_size": {"x": 3, "y": 1, "z": 2},
        "type": "Archean Build Blueprint", "version": 1,
        "datetime": "2026-10-31", "mass": 12.0, "workshop_item_id": "0000000000",
        "data": {"alias": "Analysis Bench", "version": 2, "symmetry_axis": 0,
                 "symmetry_axis_offset": 0, "indestructible": False,
                 "colors": None, "blocks": blocks, "components": components,
                 "doors": [], "frames": [], "labels": [], "pipes": pipes,
                 "struts": [], "triangles": [], "composite_builds": []},
    }
    out = os.path.join(TESTDATA, "9000009090")
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "blueprint.json"), "w") as f:
        json.dump(blueprint, f, separators=(",", ":"), ensure_ascii=False)
    print(f"wrote {out}: 1 disk, {len(PROGRAM.splitlines())} program lines")


if __name__ == "__main__":
    main()
