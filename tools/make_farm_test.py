#!/usr/bin/env python3
"""Generate testdata/9000009010/blueprint.json — the INTERCOM BENCH fixture
(v1.15.0 P9 slice C, we: "we need to have the capacity to have multiple
systems communicating with each other … multiple computers running at the
same time … communicate over their inputs/outputs … vital to test Chip's
ChipOS").

ONE craft, TWO MiniComputers, TWO paths between them:

  RADIO: 'post' runs beacon("INTERCOM","") and transmits ".k{42}" every
    cycle; the Beacon component 'recv-bee' (receiveFrequency INTERCOM) is
    wired to BOTH computers, so each pump's stepRadio feeds its ch0. The
    'listen' computer reads input_text("recv-bee",0) and writes
    output_number("radio-led",0,1) — a bus row that can ONLY appear if
    the OTHER computer's radio reached it.

  io BUS: 'post' periodically writes output_number("lamp",0,1). IoBus is
    the device's channel — every computer wired to the lamp reads it
    (the cable law, writer loopback included). 'listen' mirrors
    input_number("lamp",0) into output_number("mirror",0,7): a row that
    can ONLY appear if the shared channel crossed computers.

Determinism: both programs are pure counters; the e2e boots both IDE
windows and reads the bus rows.
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
TESTDATA = os.path.join(os.path.dirname(HERE), 'testdata')

POST = """var $b = beacon("INTERCOM", "")
var $t = 0

update
\t$t = $t + 1
\t$b.transmit(".k{42}")
\tif ($t % 20) == 10
\t\toutput_number("lamp", 0, 1)
"""

LISTEN = """var $hits = 0

update
\tvar $t = input_text("recv-bee", 0)
\tif $t != ""
\t\t$hits = $hits + 1
\t\toutput_number("radio-led", 0, 1)
\tvar $seen = input_number("lamp", 0)
\tif $seen > 0
\t\toutput_number("mirror", 0, 7)
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
    blocks = [block(x, 6, z, 0, 0, 5) for x in (3, 8) for z in (3,)]
    blocks.append(block(3, 6, 3, 5, 0, 5))
    components = [
        comp("ARCHEAN_computer", "MiniComputer", "post", 0.5, 0.25, 0,
             {"program": "post",
              "hdd": {"capacity": 4096, "label": "post",
                      "xc_files": [{"name": "post.main.xc", "plain_code": POST}]}}),
        comp("ARCHEAN_computer", "MiniComputer", "listen", -0.5, 0.25, 0,
             {"program": "listen",
              "hdd": {"capacity": 4096, "label": "listen",
                      "xc_files": [{"name": "listen.main.xc", "plain_code": LISTEN}]}}),
        # post's transmit side is the PROGRAM object; the components carry
        # the frequencies the SIM routes (FORMAT §HUD): recv-bee LISTENS.
        comp("ARCHEAN_beacon", "Beacon", "send-bee", 0.0, 0.25, 0.6,
             {"transmitFrequency": "INTERCOM", "receiveFrequency": ""}),
        comp("ARCHEAN_beacon", "Beacon", "recv-bee", 0.0, 0.25, -0.6,
             {"transmitFrequency": "", "receiveFrequency": "INTERCOM"}),
        comp("ARCHEAN_light", "Lamp", "lamp", 0.75, 0.25, 0, {}),
        comp("ARCHEAN_light", "Lamp", "mirror", -0.75, 0.25, 0, {}),
        comp("ARCHEAN_light", "Lamp", "radio-led", 0.0, 0.25, 1.2, {}),
    ]
    blueprint = {
        "author": "intercom", "box_min": {"x": -1.5, "y": -0.5, "z": -1.5},
        "box_max": {"x": 2.5, "y": 2.5, "z": 2.5},
        "box_size": {"x": 4, "y": 3, "z": 4},
        "type": "Archean Build Blueprint", "version": 1,
        "datetime": "2026-10-29", "mass": 80.0, "workshop_item_id": "0000000000",
        "data": {"alias": "Intercom Bench", "version": 2, "symmetry_axis": 0,
                 "symmetry_axis_offset": 0, "indestructible": False,
                 "colors": None, "blocks": blocks, "components": components,
                 "doors": [], "frames": [], "labels": [], "pipes": [],
                 "struts": [], "triangles": []},
    }
    out_dir = os.path.join(TESTDATA, "9000009010")
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "blueprint.json"), "w") as f:
        json.dump(blueprint, f, separators=(",", ":"), ensure_ascii=False)
    print(f"wrote {out_dir}: {len(blocks)} blocks, {len(components)} comps")

main()
