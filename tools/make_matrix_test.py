#!/usr/bin/env python3
"""Generate the component MATRIX fixtures into the blueprint corpus.

One craft per three component types (alphabetical), side by side along +x at
cell centres x=-1.375 / +0.125 / +1.625, y=z=+0.125, identity file quaternion
(the comparison with the dev viewer is orientation-convention-neutral: both
viewers agree at identity; the raw-vs-conjugate mirror only shows on a ROTATED
2026 file and is already pinned by selftest/postest).

Every component carries a 1-cell occupancy + its type-255 mirror block, so the
occupancy layer has content on both viewers. A world label names the row.
The top-level `mass` is written with OUR OWN game-file computation
(tools/game_data.py), so the Xenon viewer's 'difference' row is an instant
verdict on our mass model.

* 90000010NN — rest state (joint/state fields at rest)
* 90000020NN — deflected twin (only for rows containing a type with joint /
               state data: aileron -15°, hinge 90°, track +0.25 m, open door,
               reversed wheel, lever 0.7, button pressed…).  These pin that
               the multiple RENDERABLE parts of a component (Torus vs
               TorusReverse, mudguard, axle/steering/suspension children,
               lever/switch poses) are selected and animated like the dev.

The suite (see MATRIX.md) renders each craft in BOTH viewers at the dev's
'iso' angle and compares mass / build-cost panels + screenshots.

Regenerated deterministically:  python3 tools/make_matrix_test.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import config  # noqa: E402

# ---------- the payload table -------------------------------------------------
# Rest data per component type: curated from real 2026 corpus files (sanitized
# to empty programs), {} where the game stores nothing. Types not listed get {}.
REST_DATA = {
    'Aileron': {'angle': 0.0},
    'Beacon': {'receiveFrequency': 121.5, 'transmitFrequency': 121.5,
               'transmitData': ''},
    'BigFluidTank': {'contents': {}, 'temperature': 300.0},
    'BigWheel': {'grip': 0.5, 'mudguard': False, 'suspension': 1.0},
    'Buzzer': {'mode': 1},
    'Computer': {'hdd': {'capacity': 256, 'label': '', 'xc_files': []}},
    'Dashboard': {
        'size_x': 100, 'size_y': 60, 'version': 1, 'metallic': 0, 'roughness': 0,
        'color': {'r': 255, 'g': 255, 'b': 255, 'a': 255}, 'hideConnector': True,
        'elements': [{'type': 'Label', 'text': 'TEST', 'pos_x': 10, 'pos_y': 15,
                      'size_x': 80, 'size_y': 30, 'textAlign': 16, 'textSize': 8,
                      'state': 0,
                      'mainColor': {'r': 255, 'g': 0, 'b': 0, 'a': 255},
                      'baseColor': {'r': 255, 'g': 255, 'b': 255, 'a': 255},
                      'baseMetallic': 0, 'baseRoughness': 128}]},
    'DockableDoor': {'dock': False, 'open': False},
    'DockingPort': {'dock': False, 'itemMode': 0},
    'FluidTank': {'contents': {}, 'temperature': 300.0},
    'HighVoltageBattery': {'charged': 0.5},
    'Hitch': {'dock': False},
    'HudController': {'version': 1, 'xc_files': [{'name': 'main.xc', 'plain_code': ''}]},
    'Keyboard': {'overrideScreen': False},
    'Lamp': {'angle': 170.0, 'maxPower': 10000.0, 'rgb': {'r': 1.0, 'g': 1.0, 'b': 1.0}},
    'LinearTrack': {'acceleration': 2.0, 'inputValue': 0.0, 'manualMaxPos': 0.5,
                    'manualMinPos': -0.75, 'maxPos': 0.5, 'maxSpeed': 0.5,
                    'minPos': -0.75, 'overrideLimits': False, 'pos': 0.0,
                    'servoMode': True},
    'LowVoltageBattery': {'charged': 0.5},
    'MiniComputer': {'hdd': {'capacity': 256, 'label': '', 'xc_files': []}},
    'MiniNavInstrument': {'forward_vector_config': 0.0, 'locate_celestial': '',
                          'mode': 2},
    'NavInstrument': {'forward_vector_config': 0.0, 'locate_celestial': '',
                      'matte_screen': False, 'mode': 2},
    'Numpad': {'overrideScreen': False},
    'OwnerPad': {'overrideScreen': False},
    'PilotSeat': {'emitPlayerToken': False, 'smoothControls': False},
    'Propeller': {'blades': 4, 'pitch': 0.0, 'radius': 1.2, 'twist': 0.0,
                  'width': 0.25},
    'PushButton': {'isDualSided': False, 'singlePulse': False},
    'SmallFluidTank': {'contents': {}, 'temperature': 300.0, 'version': 1},
    'SmallHinge': {'acceleration': 2.0, 'angle': 0.0, 'inputValue': 0.0,
                   'maxSpeed': 1.0},
    'SmallPivot': {'acceleration': 2.0, 'angle': 0.0, 'inputValue': 0.0,
                   'maxSpeed': 1.0, 'servoMode': False},
    'SpotLight': {'angle': 120.0, 'maxPower': 200.0, 'rgb': {'r': 1.0, 'g': 1.0, 'b': 1.0}},
    'ThrottleLever': {'value': 0.0},
    'ToggleButton': {'allowInputFromIO': False, 'isDualSided': False,
                     'offValue': 0, 'onValue': 1, 'state': False},
    'ToiletSeat': {'smoothControls': False},
    'Volume': {'boundingRadius': 0.5, 'composition': {}, 'density': 0.0,
               'frozen': False, 'isVoxelsAirtight': False, 'liquidLevel': 0.0,
               'overrideScreen': False, 'position': {'x': 0.0, 'y': 0.0, 'z': 0.0},
               'pressure': 0.0, 'status': 0, 'temperature': 300.0,
               'totalMass': 0.0, 'version': 1, 'volume': 1.0},
    'Wheel': {'grip': 0.5, 'mudguard': False, 'suspension': 1.0},
}

# Deflected twin: overrides of REST_DATA exercising the data-driven part
# selection / joint pose the renderable node tree must honour.
DEFLECT_DATA = {
    'Aileron': {'angle': -15.0},
    'BigWheel': {'grip': 0.5, 'mudguard': True, 'reverse': True, 'suspension': 0.5},
    'Buzzer': {'mode': 0},
    'Dashboard': None,          # keep rest
    'DockableDoor': {'dock': False, 'open': True},
    'FluidTank': {'contents': {'H2O': 0.5}, 'temperature': 300.0},
    'HighVoltageBattery': {'charged': 1.0},
    'Lamp': {'angle': 90.0, 'maxPower': 10000.0, 'rgb': {'r': 1.0, 'g': 0.2, 'b': 0.2}},
    'LinearTrack': {'acceleration': 2.0, 'inputValue': 1.0, 'manualMaxPos': 0.5,
                    'manualMinPos': -0.75, 'maxPos': 0.5, 'maxSpeed': 0.5,
                    'minPos': -0.75, 'overrideLimits': False, 'pos': 0.25,
                    'servoMode': True},
    'LowVoltageBattery': {'charged': 1.0},
    'Propeller': {'blades': 6, 'pitch': 0.5, 'radius': 1.2, 'twist': 10.0,
                  'width': 0.25},
    'PushButton': {'isDualSided': True, 'singlePulse': True},
    'SmallFluidTank': {'contents': {'O2': 1.0}, 'temperature': 280.0, 'version': 1},
    'SmallHinge': {'acceleration': 2.0, 'angle': 90.0, 'inputValue': 1.0,
                   'maxSpeed': 1.0},
    'SmallPivot': {'acceleration': 2.0, 'angle': 60.0, 'inputValue': 1.0,
                   'maxSpeed': 1.0, 'servoMode': False},
    'SpotLight': {'angle': 30.0, 'maxPower': 200.0, 'rgb': {'r': 0.2, 'g': 0.4, 'b': 1.0}},
    'ThrottleLever': {'value': 0.7},
    'ToggleButton': {'allowInputFromIO': False, 'isDualSided': True,
                     'offValue': 0, 'onValue': 1, 'state': True},
    'Wheel': {'grip': 0.5, 'mudguard': True, 'reverse': True, 'suspension': 0.5},
}

# ---------- craft assembly ----------------------------------------------------

CELL = 0.25
# occupancy cell x-slots for the three slots; y=z cell 6 (centre 0.125 m)
CELL_X = [0, 6, 12]
X = [(p - 5.5) * CELL for p in CELL_X]
CZ = 0.125
PAL = {0: (255, 255, 255, 15, 0, 0), 3: (204, 204, 204, 15, 0, 1),
       43: (96, 16, 16, 15, 7, 0), 46: (16, 96, 16, 15, 7, 0),
       49: (16, 16, 96, 15, 7, 0), 52: (255, 255, 16, 15, 7, 0),
       53: (16, 255, 255, 15, 7, 0), 56: (255, 16, 255, 15, 7, 0)}


def palette():
    def ent(i):
        r, g, b, o, ro, mt = PAL[i]
        return {'r': r, 'g': g, 'b': b, 'opacity': o, 'roughness': ro,
                'metallic': mt}
    return [ent(i) if i in PAL else 0 for i in range(256)]


def occ_block(px, kind=255):
    return {'colors': [0] * 7, 'frame_x': 0, 'frame_y': 0, 'frame_z': 0,
            'material': 0, 'pos_x': px, 'pos_y': 6, 'pos_z': 6,
            'size_x': 0, 'size_y': 0, 'size_z': 0, 'type': kind}


def component(t, module, x, data):
    return {'alias': '', 'type': t, 'module': module,
            'position': {'x': x, 'y': 0.125, 'z': CZ},
            'orientation': {'w': 1.0, 'x': 0.0, 'y': 0.0, 'z': 0.0},
            'colors': [0, 3], 'mirrorAxis': 0,
            'occupancies': [{'frame_x': 0, 'frame_y': 0, 'frame_z': 0,
                             'pos_x': round(x / CELL + 5.5), 'pos_y': 6,
                             'pos_z': 6, 'size_x': 0, 'size_y': 0, 'size_z': 0}],
            'data': dict(data)}


def craft(craft_id, row_idx, comps, label):
    comps = list(comps)
    blocks = [occ_block(round(c['position']['x'] / CELL + 5.5)) for c in comps]
    bp = {
        'author': 'matrix-test',
        'box_min': {'x': -1.4, 'y': -0.2, 'z': -0.2},
        'box_max': {'x': 1.7, 'y': 0.4, 'z': 0.5},
        'box_size': {'x': 3.1, 'y': 0.6, 'z': 0.7},
        'type': 'Archean Build Blueprint',
        'version': 1,
        'datetime': '2026-10-19',
        'mass': 0.0,
        'workshop_item_id': craft_id,
        'data': {
            'alias': label,
            'version': 2,
            'symmetry_axis': 0,
            'symmetry_axis_offset': 0,
            'indestructible': False,
            'colors': palette(),
            'composite_builds': [],
            'doors': [],
            'frames': [],
            'struts': [],
            'triangles': [],
            'pipes': [],
            'labels': [{
                'text': label,
                'position': {'x': 0.125, 'y': 1.0, 'z': CZ},
                'size': 0.35, 'align_center': 1,
                'text_color': {'r': 255, 'g': 255, 'b': 255},
                'panel_color': {'r': 0, 'g': 0, 'b': 0, 'a': 255},
                'metallic': 0, 'roughness': 0,
                'dir_x': 0, 'dir_y': 0, 'dir_z': 1, 'up_x': 0, 'up_y': 1,
                'up_z': 0,
            }],
            'blocks': blocks,
            'components': comps,
        },
    }
    try:
        import game_data
        bp['mass'] = round(game_data.compute_mass(bp)['total'], 3)
    except SystemExit:
        mf = json.load(open(os.path.join(config_dir_models(), 'manifest.json')))
        bp['mass'] = sum(mf.get(c['type'], {}).get('mass', 1) for c in comps)
    return bp


def config_dir_models():
    return os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        'viewer', 'models')


def manifest_modules():
    p = os.path.join(config_dir_models(), 'manifest.json')
    return {t: e.get('module', 'ARCHEAN_parts') for t, e in json.load(open(p)).items()}


def main():
    out_root = config.blueprints_dir()
    mods = manifest_modules()
    types = sorted(mods)
    n_rows = (len(types) + 2) // 3
    made = []
    for row in range(n_rows):
        rtypes = types[row * 3:row * 3 + 3]
        for deflected in (False, True):
            comps, deflected_here = [], False
            for i, t in enumerate(rtypes):
                data = dict(REST_DATA.get(t, {}))
                if deflected and t in DEFLECT_DATA and DEFLECT_DATA[t] is not None:
                    data = dict(DEFLECT_DATA[t])
                    deflected_here = True
                comps.append(component(t, mods[t], X[i], data))
            if deflected and not deflected_here:
                continue
            cid = str((9000002000 if deflected else 9000001000) + row + 1)
            tag = f"C{row+1:02d}{'D' if deflected else ''} " + ' · '.join(rtypes)
            bp = craft(cid, row, comps, tag[:63])
            d = os.path.join(out_root, cid)
            os.makedirs(d, exist_ok=True)
            with open(os.path.join(d, 'blueprint.json'), 'w') as f:
                json.dump(bp, f, separators=(',', ':'), ensure_ascii=False)
            made.append((cid, tag))
    print(f'wrote {len(made)} matrix crafts into {out_root} '
          f'({n_rows} component rows)')
    for cid, tag in made[:4]:
        print('  e.g.', cid, tag)


if __name__ == '__main__':
    main()
