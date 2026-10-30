#!/usr/bin/env python3
"""Generate testdata/9000009040/blueprint.json — the LIVE BENCH fixture
(v1.15.6 THE LIVING CRAFT, we: "computers should start when a craft is
loaded in, and parts need to respond to signals … hinges and buttons and
pivots and ailerons actually move. And if a pivot or hinge moves, so does
its subgrid … button presses onto dashboards and screens should actually
work … if a computer is unpowered, according to craft design, show a
warning when we interact with it").

ONE craft exercises the whole chain:

  POWER: 'cell' (LowVoltageBattery) feeds 'busbar' (LowVoltageJunction),
    which feeds 'cpu' (MiniComputer) on its power_connector — cpu is ON
    the net and AUTO-BOOTS with the craft. 'ghost' (MiniComputer) carries
    a program and NO power cable: the craft HAS a grid, so ghost is
    UNPOWERED — the auto-boot leaves it off and every interaction warns
    (engine/power.ts + the ⚠ chip).

  ACTUATION: cpu's program writes output_number("hinge",0,±1) (a sweep
    after 10 cycles), output_number("pivot",0,0.5) and
    output_number("lamp",0,1)+RGB — engine/devicesim.ts swings the hinge
    axle ±90°, points the pivot, lights the lamp; 'hinge' masters a one-
    panel SUBGRID (composite_builds) so THE PANEL RIDES ITS MASTER (the
    group quaternion must move with the axle — the pin seam).

  THE 3-D PRESS: 'dash' (Dashboard, data-connector → cpu data_port.003)
    carries a ToggleButton (ch 0), a PushButton (ch 1) and a Screen
    (ch 2) whose program draws button_rect(20, 20, 80, 24, gray) with
    LITERAL geometry — the press popup names that line.

Data cables: cpu data_port.000 hinge, .001 lamp, .002 pivot, .003 dash.
Determinism: the program is a pure counter; pins read the sim/bus.
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
TESTDATA = os.path.join(os.path.dirname(HERE), 'testdata')

CPU = """var $t = 0

update
\t$t = $t + 1
\toutput_number("lamp", 0, 1)
\toutput_number("lamp", 1, 255)
\toutput_number("pivot", 0, 0.5)
\tvar $tg = input_number(3, 0)
\tif $t > 10
\t\toutput_number("hinge", 0, 1)
\telse
\t\toutput_number("hinge", 0, -1)
\tif $tg > 0
\t\toutput_number("hinge", 0, -1)
\tvar $s = screen(3, 2)
\t$s.blank(black)
\t$s.write(4, 4, white, "ARM")
\tif $s.button_rect(20, 20, 80, 24, gray)
\t\tprint("rect")

click
\tprint("arm")
"""

GHOST = """update
\toutput_number("lamp", 0, 0)
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


def pipe(ac, ap, bc, bp, kind):
    """a cable record: the power/actuation graph reads a/b ports only; the
    ONE-segment stub satisfies the pipe schema (rendered endpoints re-seat
    from the sockets, sockets.ts)."""
    return {"a_component": ac, "a_port": ap, "b_component": bc, "b_port": bp,
            "type": kind, "radius": 0.02, "flexible": False,
            "segments": [{"a": 255, "b": 255, "box": False, "chrome": False,
                          "dir": 3, "flexible": False, "g": 255, "glossy": False,
                          "length": 0.25, "metal": False, "r": 255,
                          "rounded_caps": True, "striped": False,
                          "start": {"x": 0, "y": 0.5, "z": 0}}]}


def main():
    blocks = [block(x, 6, 2, 0, 0, 4) for x in (2, 6, 10)]
    # the panel the hinge masters (a 4x1x2 slab, parent-frame absolute)
    panel = [block(x, 6, 2, 0, 0, 1) for x in (3, 4, 5, 6)]
    components = [
        comp("ARCHEAN_battery", "LowVoltageBattery", "cell", 0.5, 0.1, 0.5, {}),
        comp("ARCHEAN_energy", "LowVoltageJunction", "busbar", 0.5, 0.1, -0.25, {}),
        comp("ARCHEAN_computer", "MiniComputer", "cpu", -0.5, 0.1, 0.5,
             {"program": "cpu",
              "hdd": {"capacity": 4096, "label": "cpu",
                      "xc_files": [{"name": "cpu.main.xc", "plain_code": CPU}]}}),
        comp("ARCHEAN_computer", "MiniComputer", "ghost", -0.5, 0.1, -0.5,
             {"program": "ghost",
              "hdd": {"capacity": 4096, "label": "ghost",
                      "xc_files": [{"name": "ghost.main.xc", "plain_code": GHOST}]}}),
        comp("ARCHEAN_machines", "SmallHinge", "hinge", 1.0, 0.1, 0.0,
             {"angle": 0.0, "inputValue": 0.0, "maxSpeed": 1.0, "acceleration": 2.0}),
        comp("ARCHEAN_machines", "SmallPivot", "pivot", 1.5, 0.1, 0.5,
             {"angle": 0.0, "inputValue": 0.0, "maxSpeed": 1.0, "acceleration": 2.0,
              "servoMode": True}),
        comp("ARCHEAN_light", "Lamp", "lamp", 1.5, 0.1, -0.5,
             {"angle": 170.0, "maxPower": 1000.0, "rgb": {"r": 0.0, "g": 0.0, "b": 0.0}}),
        comp("ARCHEAN_build", "Dashboard", "dash", 0.0, 0.6, -1.0,
             {"size_x": 200, "size_y": 100, "color": {"r": 40, "g": 40, "b": 45},
              "hideConnector": False,
              "elements": [
                  {"type": "ToggleButton", "pos_x": 10, "pos_y": 10,
                   "size_x": 30, "size_y": 30,
                   "baseColor": {"r": 90, "g": 90, "b": 95},
                   "mainColor": {"r": 240, "g": 200, "b": 60}},
                  {"type": "PushButton", "pos_x": 50, "pos_y": 10,
                   "size_x": 30, "size_y": 30,
                   "baseColor": {"r": 90, "g": 90, "b": 95},
                   "mainColor": {"r": 240, "g": 80, "b": 60}},
                  {"type": "Screen", "pos_x": 90, "pos_y": 10,
                   "size_x": 100, "size_y": 80,
                   "baseColor": {"r": 10, "g": 10, "b": 12},
                   "mainColor": {"r": 0, "g": 0, "b": 0}},
              ]}),
        # the SUBGRID: ONE Build (bench at origin, identity = the law),
        # its panel blocks, and the hinge join (FLATTENED indices: the
        # nested blocks carry no component index — composite_builds keys
        # the Build and the master, both TOP-LEVEL here).
        comp("ARCHEAN_build", "Build", "", 0.0, 0.0, 0.0,
             {"blocks": panel, "components": [], "triangles": [],
              "doors": [], "frames": [], "labels": [], "pipes": [],
              "struts": [], "alias": "ramp-panel"}),
    ]
    hinge_ci = next(i for i, c in enumerate(components) if c["type"] == "SmallHinge")
    build_ci = len(components) - 1
    # pipes: power net + cpu data ports (.000 hinge, .001 lamp, .002 pivot,
    # .003 dash)
    pipes = [
        pipe(0, "connector.000", 1, "lowvoltage-input", "lowvoltage"),
        pipe(1, "lowvoltage-port.001", 2, "power_connector", "lowvoltage"),
        pipe(2, "data_port.000", 4, "data", "data"),
        pipe(2, "data_port.001", 6, "data", "data"),
        pipe(2, "data_port.002", 5, "data", "data"),
        pipe(2, "data_port.003", 7, "data-connector", "data"),
    ]
    blueprint = {
        "author": "living", "box_min": {"x": -1.5, "y": -0.5, "z": -2.0},
        "box_max": {"x": 2.5, "y": 2.5, "z": 1.5},
        "box_size": {"x": 4, "y": 3, "z": 3.5},
        "type": "Archean Build Blueprint", "version": 1,
        "datetime": "2026-10-30", "mass": 120.0, "workshop_item_id": "0000000000",
        "data": {"alias": "Live Bench", "version": 2, "symmetry_axis": 0,
                 "symmetry_axis_offset": 0, "indestructible": False,
                 "colors": None, "blocks": blocks, "components": components,
                 "doors": [], "frames": [], "labels": [], "pipes": pipes,
                 "struts": [], "triangles": [],
                 "composite_builds": [{"component": hinge_ci,
                                       "slaveBuildId": build_ci}]},
    }
    out_dir = os.path.join(TESTDATA, "9000009040")
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "blueprint.json"), "w") as f:
        json.dump(blueprint, f, separators=(",", ":"), ensure_ascii=False)
    print(f"wrote {out_dir}: {len(blocks)} blocks, {len(components)} comps, "
          f"{len(pipes)} pipes, hinge={hinge_ci} build={build_ci}")


main()
