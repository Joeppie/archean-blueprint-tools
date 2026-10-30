#!/usr/bin/env python3
"""Generate testdata/9000009060/blueprint.json — the ENERGY BENCH fixture
(v1.16.10 THE POWER FLOW, workpackages WP5).

One craft carrying every energy role the model knows, so the census, the
gates and the battery flow are all exercised on ONE blueprint:

  SolarPanel   'sun'          2700 W (wiki energy/SolarPanel.md)
  RTG          'rtg'          12 kW  (wiki energy/RTG.md)
  DieselGenerator 'gen'       150 kW HV, DATA-GATED (ch0 switches it on)
  SteamTurbine 'turb'         27 MW — 0 W: no heat source rides this craft
  LowVoltageBattery  'lv-acc'   10 kWh
  HighVoltageBattery 'hv-acc'  120 kWh  (authored charged -> start full)
  MiniComputer 'cpu'          30 W
  Lamp         'lamp'         maxPower 1000 W, gated by ch0
  MiningDrill  'drill'        100 kW — cabled on the HIGH-voltage net
  GroundAnchor 'anchor'       the drill's licence to run
  junctions/relays            the grid wiring

The deep-discharge / deficit / charging states are time walks, driven in
energy.test.ts by stepping the sim — nothing authored here goes negative.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
TESTDATA = os.path.join(os.path.dirname(HERE), 'testdata')
OUT = os.path.join(TESTDATA, '9000009060', 'blueprint.json')


def comp(module, ctype, alias, x, data=None):
    return {"module": module, "type": ctype, "alias": alias,
            "position": {"x": x, "y": 0.25, "z": 0},
            "orientation": {"w": 1, "x": 0, "y": 0, "z": 0},
            "colors": {"color1": {"r": 200, "g": 200, "b": 205, "a": 1},
                       "color2": {"r": 120, "g": 125, "b": 130, "a": 1}},
            "data": data or {}, "mirrorAxis": 0, "occupancies": []}


def pipe(ai, a_port, bi, b_port, kind='lowvoltage'):
    return {'a_component': ai, 'a_port': a_port,
            'b_component': bi, 'b_port': b_port, 'type': kind,
            'segments': [{'start': {'x': 0, 'y': 0, 'z': 0}, 'dir': 0, 'len': 0.1}]}


def block(x):
    return {"colors": [4] * 7, "frame_x": 0, "frame_y": 0, "frame_z": 0,
            "material": 0, "pos_x": x, "pos_y": 6, "pos_z": 6,
            "size_x": 0, "size_y": 0, "size_z": 0, "type": 0}


def main():
    components = [
        comp('ARCHEAN_battery', 'SolarPanel', 'sun', -4.0),                     # 0
        comp('ARCHEAN_rtg', 'RTG', 'rtg', -3.0),                                # 1
        comp('ARCHEAN_battery', 'DieselGenerator', 'gen', -2.0),                # 2
        comp('ARCHEAN_battery', 'SteamTurbine', 'turb', -1.0),                  # 3
        comp('ARCHEAN_battery', 'LowVoltageBattery', 'lv-acc', 0.0,
             {'charged': True}),                                                # 4
        comp('ARCHEAN_battery', 'HighVoltageBattery', 'hv-acc', 1.0,
             {'charged': True}),                                                # 5
        comp('ARCHEAN_computer', 'MiniComputer', 'cpu', 2.0,
             {'program': '', 'hdd': {'capacity': 256, 'label': '', 'xc_files': []}}),  # 6
        comp('ARCHEAN_light', 'Lamp', 'lamp', 3.0,
             {'angle': 170.0, 'maxPower': 1000.0,
              'rgb': {'r': 1.0, 'g': 1.0, 'b': 1.0}}),                          # 7
        comp('ARCHEAN_celestial', 'MiningDrill', 'drill', 4.0),                 # 8
        comp('ARCHEAN_anchor', 'GroundAnchor', 'anchor', 5.0),                  # 9
        comp('ARCHEAN_junction', 'LowVoltageJunction', 'lv-hub', 6.0),          # 10
    ]
    pipes = [
        # the LV net: sun + rtg -> lv-hub -> {lv-acc, cpu, lamp, drill LV? no}
        pipe(0, 'connector.000', 10, 'lowvoltage-input'),
        pipe(1, 'connector.000', 10, 'lowvoltage-input'),
        pipe(10, 'lowvoltage-port.000', 4, 'connector.000'),
        pipe(10, 'lowvoltage-port.001', 6, 'power_connector'),
        pipe(10, 'lowvoltage-port.002', 7, 'power_connector'),
        pipe(10, 'lowvoltage-port.003', 9, 'power_connector'),
        # the HV net: gen + hv-acc + the DRILL + the turbine output
        pipe(2, 'hv_connector.000', 5, 'connector.001', 'highvoltage'),
        pipe(5, 'connector.002', 8, 'power_connector', 'highvoltage'),
        pipe(3, 'hv_connector.000', 5, 'connector.003', 'highvoltage'),
        # the generator's starter is LV (wiki DieselGenerator.md)
        pipe(10, 'lowvoltage-port.004', 2, 'power_connector'),
    ]
    blueprint = {
        'author': 'energy bench',
        'box_min': {'x': -5.0, 'y': -0.5, 'z': -1.0},
        'box_max': {'x': 7.5, 'y': 2.0, 'z': 1.0},
        'box_size': {'x': 12.5, 'y': 2.5, 'z': 2.0},
        'data': {
            'alias': 'ENERGY BENCH',
            'blocks': [block(x) for x in range(1, 12)],
            'components': components,
            'mass': 0,
            'pipes': pipes,
            'max_force': 1000.0,
            'name': 'energy-bench',
        },
        'datetime': '2026-10-31 01:00:00',
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
