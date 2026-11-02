#!/usr/bin/env python3
"""Generate testdata/9000007001/blueprint.json — the X-RAY / WIRE probe fixture.

Purpose (AGENTS § Fixture rule, we 2026-10-26: "You DO NOT MAKE A TEST ON
THE TRUCK UNLESS ABSOLUTELY NECESSARY"): the wire-mode laws — a BLOCKED
cable opens the X-ray with cuts>0 + a ≥2 cursor-surge from an interior
anchor + full restore, and a cable into a ONE-WAY junction INPUT pulses one
way — used to be pinned on the 2 200-part semi truck, whose census/raycast
budget ate 120-180 s test timeouts. The laws need ONE wall and TWO cables.

Layout (identity quaternions; sockets = fp + (ax, az, -ay), the sockets.ts
law; world = file frame, y UP, nose = -z):
  deck    cells x3..9, z3..9, y0            (world x -0.625..1.125, z -0.625..1.125)
  WALL    cells x3..8, y1..4, z5  (red)     (world z -0.125..0.125) — the occluder
  parts BEHIND the wall (z >= 0.5) get occluded by it (the default camera
  sits on the -z side); parts in FRONT (z <= -0.5) are open sky.

POSITIVE pins (the laws as shipped):
  A FluidJunction       (-0.4,-1.0, 0.5)   out.001 socket (-0.275,-0.875,0.5)
  B FluidJunction       ( 0.4,-1.0, 1.0)   fluid-in  socket ( 0.4,-1.125,1.0)
  Battery LowVoltageBattery (-0.4,-1.0,1.25) connector.000 (-0.5,-0.75,1.15)
  LVJ   LowVoltageJunction  ( 0.2,-1.0,1.5)  lowvoltage-input (0.075,-1.0,1.5)
  pipe 0 fluid A->B  out.001 <-> out.002 (UNDIRECTED: flowDir 'both'),
         [+z 0.9, +x 0.55, -z 0.4]: cuts>0 + interior anchor -> the >=2
         cursor-surge law (a directed out->in pair pulses ONCE by the
         v1.11.7 one-way rule — that negative lives on pipe 2)
  pipe 1 lv  Bat->LVJ[+z 0.55, +x 0.575, -z 0.2, -y 0.25]  hub INPUT: 'ab'
         one-way (v1.11.7)

NEGATIVE material (wrong-cable / wrong-component failure paths — a fixture
a test can ONLY pass if it discriminates):
  C FluidJunction        ( 2.5,-0.3,-0.5)   D FluidJunction (3.2,-0.3,-0.5)
         (the front distractors sit OUTSIDE the wall/deck x-range and FLOAT
         at y -0.3: the cuts==0 negative path stays honest)
         (the front distractors FLOAT at y -0.3: deck-grazing sight lines would
         occlude them — floats keep the NEGATIVE cuts==0 path honest)
  pipe 2 fluid C->D  [+x 0.575, -y 0.25]  3 pts, IN FRONT of the wall:
         cuts == 0 (the census must not pick it) AND poly < 4 points (the
         >=2-surge filter must reject it)
  Battery BAT2        ( 0.7,-1.0,-1.0)     LVJ2 LVJ (0.9,-1.0,-1.2)
  pipe 3 lv Bat2 -> LVJ2 'lowvoltage-port.002' (a hub DOWNSTREAM port on a
         source->hub pairing = a broken-claim cable, in front: the wire
         panel must list it as claimed and the flow law must degrade
         sanely — the fixture-side half of the backlog integrity check)
  Beacon              ( 0.7,-1.0,-1.25)    UNWIRED: its port census is
         empty, hovering it yields no cable, the cable list has 4 rows.

Modern file (data.colors present) = the generation the app's wire rules pin.
"""
import json, os, sys

# The fixture is a COMMITTED corpus artefact (like orient 9000000001): it
# lives in the repo's testdata and the app serves testdata as its corpus
# base — deliberately NOT config.blueprints_dir(), which on an in-game
# machine resolves to the machine-local saves overlay.
HERE = os.path.dirname(os.path.abspath(__file__))
TESTDATA = os.path.join(os.path.dirname(HERE), 'testdata')

def block(pos, slot, size=(0, 0, 0)):
    x, y, z = pos
    return {"colors": [slot] * 7, "frame_x": 0, "frame_y": 0, "frame_z": 0,
            "material": 0, "pos_x": x, "pos_y": y, "pos_z": z,
            "size_x": size[0], "size_y": size[1], "size_z": size[2], "type": 0}

def comp(module, ctype, fp, data=None):
    return {"module": module, "type": ctype,
            "position": {"x": fp[0], "y": fp[1], "z": fp[2]},
            "orientation": {"w": 1, "x": 0, "y": 0, "z": 0},
            "colors": {"color1": {"r": 200, "g": 200, "b": 205, "a": 1},
                       "color2": {"r": 120, "g": 125, "b": 130, "a": 1}},
            "data": data or {}, "mirrorAxis": 0, "occupancies": []}

def seg(start, d, length, rgb, flexible=False):
    x, y, z = start
    r, g, b = rgb
    return {"a": 255, "b": b, "box": False, "chrome": False, "dir": d,
            "flexible": flexible, "g": g, "glossy": False, "length": length,
            "metal": False, "r": r, "rounded_caps": True, "striped": False,
            "start": {"x": x, "y": y, "z": z}}

def chain(start, moves):
    """segments from start along [(dir, len)]; returns (segs, end)."""
    p = list(start)
    D = [(1, 0, 0), (0, 1, 0), (0, 0, 1), (-1, 0, 0), (0, -1, 0), (0, 0, -1)]
    segs = []
    for d, ln in moves:
        segs.append(seg(tuple(p), d, ln, (128, 128, 128)))
        dv = D[d]
        p = [p[0] + dv[0] * ln, p[1] + dv[1] * ln, p[2] + dv[2] * ln]
    return segs, tuple(p)

blocks = []
for x in range(3, 10):
    for z in range(3, 10):
        blocks.append(block((x, 0, z), 51))                       # deck, matte navy
for x in range(3, 9):
    for y in range(1, 5):
        blocks.append(block((x, y, 5), 43))                       # WALL, matte red

# sockets = fp + (ax, az, -ay)  (identity quaternion, the sockets.ts law)
A    = (-0.4, -1.0, 0.5);   sA   = (A[0] + 0.125, A[1] + 0.125, A[2])
B    = (0.4, -1.0, 1.0);    sB   = (B[0] - 0.125, B[1] + 0.125, B[2])   # out.002 socket
BAT  = (-0.4, -1.0, 1.25);  sBAT = (BAT[0] - 0.1, BAT[1] + 0.25, BAT[2] - 0.1)
LVJ  = (0.2, -1.0, 1.5);    sLVJ = (LVJ[0] - 0.125, LVJ[1] + 0.0, LVJ[2])
C    = (2.5, -0.3, -0.5);   sC   = (C[0] + 0.125, C[1] + 0.125, C[2])
D    = (3.2, -0.3, -0.5);   sD   = (D[0] + 0.0,  D[1] - 0.125, D[2])
BAT2 = (2.9, -0.3, -1.0);   sB2  = (BAT2[0] - 0.1, BAT2[1] + 0.25, BAT2[2] - 0.1)
LVJ2 = (3.1, -0.3, -1.2);   sL2  = (LVJ2[0] + 0.125, LVJ2[1] + 0.0, LVJ2[2] - 0.062)
BEA  = (3.0, -0.3, -1.25)                      # unwired distractor

segs0, end0 = chain(sA,  [(2, 0.9), (0, 0.55), (5, 0.4)])
segs1, end1 = chain(sBAT, [(2, 0.55), (0, 0.575), (5, 0.2), (4, 0.25)])
segs2, end2 = chain(sC,  [(0, 0.575), (4, 0.25)])                 # 3 pts
segs3, end3 = chain(sB2, [(0, 0.425), (4, 0.25), (5, 0.162)])
for end, s in [(end0, sB), (end1, sLVJ), (end2, sD), (end3, sL2)]:
    assert all(abs(end[i] - s[i]) < 1e-9 for i in range(3)), (end, s)

pipes = [
    # 0: BLOCKED positive (behind the wall, 5-segment run, interior anchor).
    # out<->out ports = UNDIRECTED (flowDir 'both' -> the >=2-surge law is
    # the one under test; a directed out->in pair would lawfully pulse ONCE)
    {"a_component": 0, "a_port": "fluid-out.001", "b_component": 1,
     "b_port": "fluid-out.002", "radius": 0.045, "type": "fluid",
     "segments": segs0},
    # 1: ONE-WAY positive (hub lowvoltage-INPUT)
    {"a_component": 2, "a_port": "connector.000", "b_component": 3,
     "b_port": "lowvoltage-input", "radius": 0.02, "type": "lowvoltage",
     "segments": segs1},
    # 2: negative — in FRONT (cuts must be 0) and 3-point (surge filter)
    {"a_component": 4, "a_port": "fluid-out.001", "b_component": 5,
     "b_port": "fluid-in", "radius": 0.045, "type": "fluid", "segments": segs2},
    # 3: broken-claim cable — source -> hub DOWNSTREAM port (front)
    {"a_component": 6, "a_port": "connector.000", "b_component": 7,
     "b_port": "lowvoltage-port.002", "radius": 0.02, "type": "lowvoltage",
     "segments": segs3},
]

components = [
    comp("ARCHEAN_junction", "FluidJunction", A),
    comp("ARCHEAN_junction", "FluidJunction", B),
    comp("ARCHEAN_battery", "LowVoltageBattery", BAT),
    comp("ARCHEAN_junction", "LowVoltageJunction", LVJ),
    comp("ARCHEAN_junction", "FluidJunction", C),
    comp("ARCHEAN_junction", "FluidJunction", D),
    comp("ARCHEAN_battery", "LowVoltageBattery", BAT2),
    comp("ARCHEAN_junction", "LowVoltageJunction", LVJ2),
    comp("ARCHEAN_beacon", "Beacon", BEA),
]

# modern palette = the orient-test 256-slot table (families present)
orient = json.load(open(os.path.join(TESTDATA, "9000000001", "blueprint.json")))
colors = orient["data"]["colors"]

blueprint = {
    "author": "xray-test",
    "box_min": {"x": -1.0, "y": -1.5, "z": -0.9},
    "box_max": {"x": 3.6, "y": 0.2, "z": 1.8},
    "box_size": {"x": 4.6, "y": 1.7, "z": 3.4},
    "type": "Archean Build Blueprint",
    "version": 1,
    "datetime": "2026-10-26",
    "mass": 96.0,
    "workshop_item_id": "0000000000",
    "data": {
        "alias": "xray-test",
        "version": 2,
        "symmetry_axis": 0,
        "symmetry_axis_offset": 0,
        "indestructible": False,
        "colors": colors,
        "blocks": blocks,
        "components": components,
        "doors": [],
        "frames": [],
        "labels": [],
        "pipes": pipes,
        "struts": [],
        "triangles": [],
    },
}

out_dir = os.path.join(TESTDATA, "9000007001")
os.makedirs(out_dir, exist_ok=True)
out = os.path.join(out_dir, "blueprint.json")
with open(out, "w") as f:
    json.dump(blueprint, f, separators=(",", ":"), ensure_ascii=False)
print(f"wrote {out}: {len(blocks)} blocks, {len(components)} comps, {len(pipes)} pipes")
