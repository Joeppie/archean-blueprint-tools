#!/usr/bin/env python3
"""Generate testdata/9000009050/blueprint.json — the CHIPOS BENCH fixture
(v1.16.10 THE APPKIT BUS, workpackages batch 2026-10-30/31).

The law this fixture carries lives INSIDE third-party programs (Chip
Patton's ChipOS + App Kit apps) — a hand-written program CANNOT exhibit
it, so the fixture embeds the REAL disks verbatim:

  chipos          = the MiniComputer 'chipos' of the ChipOS Developer's
                    Kit v0.41b (testdata/3828773626) — the 52-file OS,
  app-1           = 'App TETRIS'  (same craft) — the App Kit v3 client,
  app-2           = 'App HELLO'   (same craft),
  app-earthnav    = EarthNAV v1.0 (testdata/3828827922) — a module offered
                    to a main installation exactly like the others,
  main-screen     = the dev kit's HdScreen dashboard,
  main-router     = the MiniRouter the whole net hangs on (alias-resolved,
                    so every device carries the computer's LOCAL port),
  LV Switch / battery / junction = the dev kit's own power convention
                    (grid present -> the power law applies; every computer
                    is on the net).

Net law (wiki computers/Router.md + chipos-appkit.xc's header): the app
computers publish their manifest with output_text("chipos", 0,
".kit{3}.name{TETRIS}..."); ChipOS scans the data network every 3 s and
polls input_text(appAlias, 0); events go BACK as text onto the app's
router port — the app's input.N handlers catch them (ABI 16 RunInput).

Deterministic and offline: every byte comes from the repo corpus.
"""
import copy
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
TESTDATA = os.path.join(os.path.dirname(HERE), 'testdata')
OUT = os.path.join(TESTDATA, '9000009050', 'blueprint.json')


def load(wid):
    with open(os.path.join(TESTDATA, wid, 'blueprint.json'), encoding='utf-8') as f:
        return json.load(f)


def find_comps(bp, alias=None, ctype=None):
    return [c for c in bp['data']['components']
            if (alias is None or c.get('alias') == alias)
            and (ctype is None or c.get('type') == ctype)]


def place(c, x, y, z):
    c = copy.deepcopy(c)
    c['position'] = {'x': x, 'y': y, 'z': z}
    return c


def pipe(ai, a_port, bi, b_port, kind='data', seg=None):
    """A cable record between component INDICES (ports verbatim)."""
    return {
        'a_component': ai, 'a_port': a_port,
        'b_component': bi, 'b_port': b_port, 'type': kind,
        'segments': seg or [{'start': {'x': 0, 'y': 0, 'z': 0},
                             'dir': 0, 'len': 0.1}],
    }


def block(x, y, z):
    return {"colors": [4] * 7, "frame_x": 0, "frame_y": 0, "frame_z": 0,
            "material": 0, "pos_x": x, "pos_y": y, "pos_z": z,
            "size_x": 0, "size_y": 0, "size_z": 0, "type": 0}


def main():
    kit = load('3828773626')
    nav = load('3828827922')

    chipos = find_comps(kit, 'chipos', 'MiniComputer')[0]
    app1 = find_comps(kit, 'app-1', 'MiniComputer')[0]
    app2 = find_comps(kit, 'app-2', 'MiniComputer')[0]
    navc = find_comps(nav, 'app-earthnav', 'MiniComputer')[0]
    dash = find_comps(kit, 'main-screen', 'Dashboard')[0]
    router = find_comps(kit, 'main-router', 'MiniRouter')[0]
    relay = find_comps(kit, 'LV Switch', 'LowVoltageRelay')[0]
    batt = find_comps(kit, 'Main LV Battery', 'LowVoltageBattery')[0]
    junction = copy.deepcopy(router)            # a LowVoltageJunction clone below
    junction = {
        'module': 'ARCHEAN_junction', 'type': 'LowVoltageJunction', 'alias': 'LV bus',
        'position': {'x': 0, 'y': 0, 'z': 0},
        'orientation': {'w': 1, 'x': 0, 'y': 0, 'z': 0},
        'colors': {'color1': {'r': 120, 'g': 125, 'b': 130, 'a': 1},
                   'color2': {'r': 120, 'g': 125, 'b': 130, 'a': 1}},
        'data': {}, 'mirrorAxis': 0, 'occupancies': [],
    }

    components = [
        place(chipos, -1.0, 0.25, 0.0),      # 0
        place(app1, -0.5, 0.25, 0.0),        # 1  TETRIS
        place(app2, 0.0, 0.25, 0.0),         # 2  HELLO
        place(navc, 0.5, 0.25, 0.0),         # 3  EarthNAV
        place(dash, 1.5, 0.25, 0.0),         # 4  main-screen
        place(router, 0.0, 0.25, 0.8),       # 5  main-router
        place(relay, -1.5, 0.25, 0.8),       # 6  LV Switch
        place(batt, -2.0, 0.25, 0.8),        # 7  battery
        place(junction, 0.8, 0.25, 0.8),     # 8  LV bus junction
    ]
    pipes = [
        pipe(0, 'data_port.000', 5, 'data_port.0'),
        pipe(1, 'data_port.000', 5, 'data_port.1'),
        pipe(2, 'data_port.001', 5, 'data_port.2'),
        pipe(3, 'data_port.000', 5, 'data_port.3'),
        pipe(4, 'data-connector', 5, 'data_port.4'),
        pipe(0, 'data_port.001', 6, 'data-port'),
        pipe(7, 'data-port', 0, 'data_port.002'),
        # the dev kit's power convention: battery -> relay -> junction ->
        # {router, app-1, app-2, earthnav}; chipos straight off the battery
        pipe(7, 'connector.002', 0, 'power_connector', 'lowvoltage'),
        pipe(7, 'connector.003', 6, 'lowvoltage-input', 'lowvoltage'),
        pipe(6, 'lowvoltage-output', 8, 'lowvoltage-input', 'lowvoltage'),
        pipe(8, 'lowvoltage-port.004', 5, 'lowvoltage', 'lowvoltage'),
        pipe(8, 'lowvoltage-port.001', 1, 'power_connector', 'lowvoltage'),
        pipe(8, 'lowvoltage-port.002', 2, 'power_connector', 'lowvoltage'),
        pipe(8, 'lowvoltage-port.003', 3, 'power_connector', 'lowvoltage'),
    ]
    blocks = [block(x, 6, z) for x in range(2, 11) for z in range(2, 8)]

    blueprint = {
        'author': 'ChipOS bench',
        'box_min': {'x': -3.0, 'y': -0.5, 'z': -1.0},
        'box_max': {'x': 3.0, 'y': 2.0, 'z': 2.0},
        'box_size': {'x': 6.0, 'y': 2.5, 'z': 3.0},
        'data': {
            'alias': 'CHIPOS BENCH',
            'blocks': blocks,
            'components': components,
            'mass': 0,
            'pipes': pipes,
            'max_force': 1000.0,
            'name': 'chipos-bench',
        },
        'datetime': '2026-10-31 00:30:00',
        'mass': 0,
        'type': 'Ship',
        'version': 'v2',
    }
    # a mass the game accepts: the kit's own components carry their mass
    total = sum(c.get('mass', 0) for c in components)
    blueprint['mass'] = blueprint['data']['mass'] = total

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(blueprint, f, separators=(',', ':'), ensure_ascii=False)
    print(f'wrote {OUT} '
          f'({os.path.getsize(OUT)} bytes, {len(components)} components, '
          f'{len(pipes)} cables)')
    for i, c in enumerate(components):
        print(f'  {i}: {c["type"]:<18} {c.get("alias","")}')


if __name__ == '__main__':
    sys.exit(main())
