#!/usr/bin/env python3
"""Generate testdata/9000009070/blueprint.json — the ITEM BENCH fixture
(v1.16.10 ITEMS ON BELTS, workpackages WP6).

Two item chains on one powered, ANCHORED craft (mining/MiningDrill.md:
the drill needs the anchor; it pushes 10 rocks/s on the LV net):

  MiningDrill 'drill' ─0.75m─ ItemJunction 'jx' ─0.25m─ Crusher 'crush'
      ─0.25m─ Container 'ore-A'                      (rock → crushed)
  (a bare belt row, wired by touching AABBs, no source: the link law)
  ItemConveyor 'belt-1' ─ ItemConveyor 'belt-2' ─ Container 'ore-B'

  RTG 'rtg' → LowVoltageJunction → { drill, containers }  (the grid)
  GroundAnchor 'anchor' — the drill's licence to run

Cells sit on the 0.25 m lattice exactly; the gaps are the ones the link
law (0.8 m) must accept, and Jimmy's Adventure carries the real-world
0.75 m drill→junction gap this fixture mirrors.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
TESTDATA = os.path.join(os.path.dirname(HERE), 'testdata')
OUT = os.path.join(TESTDATA, '9000009070', 'blueprint.json')


def occ(fx, fy, fz, px, py, pz, sx, sy, sz):
    return {'frame_x': fx, 'frame_y': fy, 'frame_z': fz,
            'pos_x': px, 'pos_y': py, 'pos_z': pz,
            'size_x': sx, 'size_y': sy, 'size_z': sz}


def world(oc, a):
    fr = [oc['frame_x'], oc['frame_y'], oc['frame_z']]
    ps = [oc['pos_x'], oc['pos_y'], oc['pos_z']]
    lo = fr[a] * 3 + (ps[a] - 5.5) * 0.25
    return (lo, lo + 0.25)


def center(oc):
    c = []
    for a in range(3):
        lo, hi = world(oc, a)
        sz = [oc['size_x'], oc['size_y'], oc['size_z']][a]
        c.append((lo + hi) / 2 + sz * 0.125)
    return c


def comp(module, ctype, alias, oc):
    x, y, z = center(oc)
    return {'module': module, 'type': ctype, 'alias': alias,
            'position': {'x': round(x, 3), 'y': round(y, 3), 'z': round(z, 3)},
            'orientation': {'w': 1, 'x': 0, 'y': 0, 'z': 0},
            'colors': {'color1': {'r': 200, 'g': 200, 'b': 205, 'a': 1},
                       'color2': {'r': 120, 'g': 125, 'b': 130, 'a': 1}},
            'data': {}, 'mirrorAxis': 0, 'occupancies': [oc]}


def pipe(ai, a_port, bi, b_port, kind='lowvoltage'):
    return {'a_component': ai, 'a_port': a_port,
            'b_component': bi, 'b_port': b_port, 'type': kind,
            'segments': [{'start': {'x': 0, 'y': 0, 'z': 0}, 'dir': 0, 'len': 0.1}]}


def block(x, y, z):
    return {"colors": [4] * 7, "frame_x": 0, "frame_y": 0, "frame_z": 0,
            "material": 0, "pos_x": x, "pos_y": y, "pos_z": z,
            "size_x": 0, "size_y": 0, "size_z": 0, "type": 0}


def main():
    drill = occ(0, 0, 0, 4, 7, 4, 7, 7, 3)
    jx = occ(0, 0, 0, 6, 7, 11, 0, 0, 3)
    crush = occ(0, 0, 0, 5, 7, 15, 3, 3, 3)
    a = occ(0, 0, 0, 5, 7, 19, 3, 3, 7)
    # the belt row sits clear of the drill's 2 m footprint (max-axis gap
    # > 0.8 m — the bare row must NOT link to the drill)
    belt1 = occ(0, 0, 0, 0, 1, 6, 1, 1, 3)
    belt2 = occ(0, 0, 0, 0, 1, 10, 1, 1, 3)
    b = occ(0, 0, 0, 0, 1, 14, 3, 3, 7)
    anchor = occ(0, 0, 0, 2, 1, 20, 1, 1, 1)
    battery = occ(0, 0, 0, 9, 2, 2, 1, 1, 3)
    rtg = occ(0, 0, 0, 9, 2, 6, 1, 1, 3)
    junc = occ(0, 0, 0, 9, 2, 10, 1, 1, 1)
    components = [
        comp('ARCHEAN_celestial', 'MiningDrill', 'drill', drill),       # 0
        comp('ARCHEAN_machines', 'ItemJunction', 'jx', jx),             # 1
        comp('ARCHEAN_machines', 'Crusher', 'crush', crush),            # 2
        comp('ARCHEAN_storage', 'Container', 'ore-A', a),               # 3
        comp('ARCHEAN_machines', 'ItemConveyor', 'belt-1', belt1),      # 4
        comp('ARCHEAN_machines', 'ItemConveyor', 'belt-2', belt2),      # 5
        comp('ARCHEAN_storage', 'Container', 'ore-B', b),               # 6
        comp('ARCHEAN_anchor', 'GroundAnchor', 'anchor', anchor),       # 7
        comp('ARCHEAN_battery', 'LowVoltageBattery', 'acc', battery),   # 8
        comp('ARCHEAN_rtg', 'RTG', 'rtg', rtg),                         # 9
        comp('ARCHEAN_junction', 'LowVoltageJunction', 'lv', junc),     # 10
    ]
    components[8]['data'] = {'charged': True}
    pipes = [
        pipe(9, 'connector.000', 10, 'lowvoltage-input'),
        pipe(10, 'lowvoltage-port.000', 8, 'connector.000'),
        pipe(10, 'lowvoltage-port.001', 0, 'power_connector'),
        pipe(10, 'lowvoltage-port.002', 3, 'lowvoltage'),
        pipe(10, 'lowvoltage-port.003', 6, 'lowvoltage'),
    ]
    blueprint = {
        'author': 'items bench',
        'box_min': {'x': -2.0, 'y': -2.0, 'z': -2.0},
        'box_max': {'x': 3.0, 'y': 3.0, 'z': 6.0},
        'box_size': {'x': 5.0, 'y': 5.0, 'z': 8.0},
        'data': {
            'alias': 'ITEM BENCH',
            'blocks': [block(x, 4, z) for x in range(1, 12) for z in (2, 3)],
            'components': components,
            'mass': 0,
            'pipes': pipes,
            'max_force': 1000.0,
            'name': 'items-bench',
        },
        'datetime': '2026-10-31 01:30:00',
        'mass': 0,
        'type': 'Ship',
        'version': 'v2',
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(blueprint, f, separators=(',', ':'), ensure_ascii=False)
    print(f'wrote {OUT} ({len(components)} components, {len(pipes)} cables)')


if __name__ == '__main__':
    main()
