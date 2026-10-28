#!/usr/bin/env python3
"""Generate testdata/9000008001/blueprint.json — the BUZZER BENCH fixture.

Purpose (we 2026-10-28: "I DO NOT WANT an integration test that runs the
full mario game; instead just write a computer that outputs a signal to a
single buzzer, and see if it does its thing"): the whole audio law —
XenonCode output_number -> io bus -> engine/buzzer.ts -> WebAudio analyser —
pinned by ONE MiniComputer, ONE Buzzer, and a deterministic pulse program.
No game, no sprites, boots in seconds.

Layout (identity quaternions; world = file frame):
  deck    cells x3..8, z3..8, y6          (a craft shell; grounds the scene)
  MiniComputer 'bench'  (0.5, 0.25, 0)   data.hdd.xc_files: bench.main.xc
  Buzzer 'bench-horn'   (0.0, 0.25, 0)   data {mode: 3} = SAWTOOTH (the
                                         authored-tone law under test)

The program (deterministic phase — asserts run from a fresh boot):
  every update: counter +1; a 20-cycle pulse (10 on / 10 off) drives the
  horn's Amplitude at 0.8 with a 440 Hz Frequency; the second half of each
  period the frequency steps to 660. It also paints a blinking rectangle
  into a virtualscreen(160,120) — the fixture's first virtualscreen, so
  the dash deep link (?dash=first-virtual) has a canvas to focus.
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
TESTDATA = os.path.join(os.path.dirname(HERE), 'testdata')

PROGRAM = """var $t = 0

update
  $t += 1
  var $aux = input_number("gamer", 8)
  var $amp = 0.2 + $aux * 0.6
  var $hz = 440
  if ($t % 40) >= 20
    $hz = 660
  output_number("bench-horn", 0, $amp)
  output_number("bench-horn", 1, $hz)
  if $t == 1
    $tv = virtualscreen(160, 120)
    $tv.blank()
  $tv = screen("virtual#0", 0)
  if ($t % 4) < 2
    $tv.draw_rect(20, 20, 140, 100, color(255, 80, 0))
  else
    $tv.draw_rect(20, 20, 140, 100, color(0, 120, 255))
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
    # the deck: a shallow slab of blocks so the craft has a hull
    blocks = [block(x, 6, z, 0, 0, 5) for x in (3, 8) for z in (3,)]
    blocks.append(block(3, 6, 3, 5, 0, 5))
    components = [
        comp("ARCHEAN_computer", "MiniComputer", "bench", 0.5, 0.25, 0,
             {"program": "bench",
              "hdd": {"capacity": 4096, "label": "bench",
                      "xc_files": [{"name": "bench.main.xc", "plain_code": PROGRAM}]}}),
        comp("ARCHEAN_beep", "Buzzer", "bench-horn", 0.0, 0.25, 0, {"mode": 3}),
        # the cockpit under test: the program mirrors the seat's Aux 1 into
        # the horn's amplitude, so the pilot-key law is pinned WITHOUT the
        # full Mario game (we: "see if it does its thing")
        comp("ARCHEAN_avatar", "PilotSeat", "gamer", 1.0, 0.25, 0, {}),
    ]
    blueprint = {
        "author": "bench", "box_min": {"x": -1, "y": -0.5, "z": -1},
        "box_max": {"x": 2.5, "y": 2.5, "z": 2.5},
        "box_size": {"x": 3.5, "y": 3, "z": 3.5},
        "type": "Archean Build Blueprint", "version": 1,
        "datetime": "2026-10-28", "mass": 60.0, "workshop_item_id": "0000000000",
        "data": {"alias": "Buzzer Bench", "version": 2, "symmetry_axis": 0,
                 "symmetry_axis_offset": 0, "indestructible": False,
                 "colors": None, "blocks": blocks, "components": components,
                 "doors": [], "frames": [], "labels": [], "pipes": [],
                 "struts": [], "triangles": []},
    }
    out_dir = os.path.join(TESTDATA, "9000008001")
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "blueprint.json"), "w") as f:
        json.dump(blueprint, f, separators=(",", ":"), ensure_ascii=False)
    print(f"wrote {out_dir}: {len(blocks)} blocks, {len(components)} comps")

main()
