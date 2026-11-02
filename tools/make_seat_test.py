#!/usr/bin/env python3
"""Generate testdata/9000009091/blueprint.json — the SEAT BENCH (v1.16.15,
we: "im sending to an aileron, but I dont see effect").

A PilotSeat cables its ROLL channel (data_port.005) straight to an
Aileron's data port; a MiniComputer is cabled to the seat (data_port.010)
so its pump binds the FULL COCKPIT SURFACE. The program is inert on
purpose: the aileron must deflect from the SEAT CHANNEL ALONE (the game's
direct seat->surface wiring). The cockpit e2e sits in the seat, latches
Q (roll -) and asserts the aileron joint swings.
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
TESTDATA = os.path.join(os.path.dirname(HERE), 'testdata')

PROGRAM = "update\n\tprint(1)\n"


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
    blocks = [block(4, 6, 4, sx=6, sy=0, sz=6)]
    components = [
        comp("ARCHEAN_avatar", "PilotSeat", "", 0.0, 1.75, -1.0),
        comp("ARCHEAN_aileron", "Aileron", "aile", 1.25, 1.6, 0.25),
        comp("ARCHEAN_computer", "MiniComputer", "pilot", 0.5, 1.75, 0.75,
             {"program": "",
              "hdd": {"capacity": 8192, "label": "bench",
                      "xc_files": [{"name": "main.xc",
                                    "plain_code": PROGRAM}]}}),
        comp("ARCHEAN_battery", "LowVoltageBattery", "cell", -1.0, 1.5, 0.0),
        # v1.16.15: a steerable nose wheel fed by TWO seat cables (the port
        # indexes them in drop order: Accelerate then Steer) and an RCS
        # thruster fed by the Yaw channel port
        comp("ARCHEAN_wheel", "SmallWheel", "nose", -0.5, 1.35, -0.75),
        comp("ARCHEAN_rcs", "RCS", "rcs1", 0.75, 1.9, -0.5),
    ]
    pipes = [
        pipe(0, "data_port.005", 1, "data-connector", "data"),   # seat ROLL -> aileron
        pipe(0, "data-port", 2, "data_port.010", "data"),        # seat -> computer
        pipe(3, "connector.000", 2, "power_connector", "lowvoltage"),
        pipe(3, "connector.001", 0, "lowvoltage", "lowvoltage"),
        pipe(0, "data_port.001", 4, "data-port", "data"),     # nose: Accelerate
        pipe(0, "data_port.002", 4, "data-port", "data"),     # nose: Steer
        pipe(0, "data_port.006", 5, "data", "data"),          # rcs: Yaw nozzle
    ]
    blueprint = {
        "author": "seatbench", "box_min": {"x": -1.5, "y": 1.0, "z": -1.5},
        "box_max": {"x": 2.0, "y": 2.0, "z": 1.5},
        "box_size": {"x": 3.5, "y": 1, "z": 3},
        "type": "Archean Build Blueprint", "version": 1,
        "datetime": "2026-11-01", "mass": 18.0, "workshop_item_id": "0000000000",
        "data": {"alias": "Seat Bench", "version": 2, "symmetry_axis": 0,
                 "symmetry_axis_offset": 0, "indestructible": False,
                 "colors": None, "blocks": blocks, "components": components,
                 "doors": [], "frames": [], "labels": [], "pipes": pipes,
                 "struts": [], "triangles": [], "composite_builds": []},
    }
    out = os.path.join(TESTDATA, "9000009091")
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "blueprint.json"), "w") as f:
        json.dump(blueprint, f, separators=(",", ":"), ensure_ascii=False)
    print(f"wrote {out}: seat->aileron direct, inert computer")


if __name__ == "__main__":
    main()
