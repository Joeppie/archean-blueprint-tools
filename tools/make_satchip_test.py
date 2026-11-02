#!/usr/bin/env python3
"""Generate testdata/9000009098/blueprint.json — the CHIP SAT BENCH fixture
(v1.17.0, we: "create and add and test ChipOS setup that has satellite
connections into its main comp for earthnav and Tetris apps, and make it
work").

The CHIPOS BENCH (9000009050) hangs every app computer on the ONE MiniRouter
directly. This bench proves the SATELLITE shape: the app computers reach the
main computer through their OWN DataBridge (the game's per-part satellite
link — a passive conductor: data passes, power does not), and ChipOS still
sees them as devices, installs their appkit manifests and runs them:

    app-tetris   (the REAL App TETRIS disk)  -data-port-> sat-link-tetris
    app-earthnav (EarthNAV v1.0 from 3828827922) -data-port-> sat-link-nav
    sat-link-*   -data_port.NNN-> main-router  (MiniRouter)
    chipos       -data-port-> main-router      (the OS, alias 'chipos')
    main-screen  HdScreen dashboard           (the OS's display)
    LV battery -> relay -> junction -> {router, apps}  (the grid; the relay
                 is the app-facing assertion ChipOS drives after its scan)

Components and DISKS are copied verbatim from the committed bench — no
external inputs, deterministic. The e2e (e2e/chipossat.spec.ts) pins:
both satellites INSTALL on the bus, and a page RELOAD (storage persistence,
v1.16.27) must NOT reinstall — the OS remembers its installed apps exactly
like it does beside the save in the game.
"""
import copy
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
TESTDATA = os.path.join(os.path.dirname(HERE), 'testdata')
SRC = os.path.join(TESTDATA, '9000009050', 'blueprint.json')
OUT = os.path.join(TESTDATA, '9000009098')

# source indices in 9000009050
CHIP, TET, HELLO, NAV, SCR, ROUTER, RELAY, BATT, JUNC = range(9)
# remap (HELLO drops out; everything shifts)
KEEP = [CHIP, TET, NAV, SCR, ROUTER, RELAY, BATT, JUNC]
REMAP = {old: new for new, old in enumerate(KEEP)}
TET2, NAV2 = REMAP[TET], REMAP[NAV]
SCR2, ROUTER2, RELAY2, BATT2, JUNC2 = REMAP[SCR], REMAP[ROUTER], REMAP[RELAY], REMAP[BATT], REMAP[JUNC]
BR_TET, BR_NAV = len(KEEP), len(KEEP) + 1


def bridge(x, px):
    """A DataBridge part (module ARCHEAN_junction, no program data)."""
    return {"module": "ARCHEAN_junction", "type": "DataBridge", "alias": x,
            "position": {"x": px, "y": 0.25, "z": 0.6},
            "orientation": {"w": 1, "x": 0, "y": 0, "z": 0},
            "colors": {"color1": {"r": 160, "g": 170, "b": 180, "a": 1},
                       "color2": {"r": 90, "g": 95, "b": 105, "a": 1}},
            "data": {}, "mirrorAxis": 0, "occupancies": []}


def pipe(ac, ap, bc, bp, kind='data'):
    return {"a_component": ac, "a_port": ap, "b_component": bc, "b_port": bp,
            "type": kind if kind != 'data' else None,
            "radius": 0.02, "flexible": True, "segments": [],
            "a_adapter": ap, "b_adapter": bp}


def main():
    src = json.load(open(SRC))
    comps = [copy.deepcopy(src['data']['components'][i]) for i in KEEP]
    # the satellite computers sit a little apart (visual only)
    comps[TET2]['position'] = {"x": -1.1, "y": 0.25, "z": 0.9}
    comps[TET2]['alias'] = 'app-tetris'    # the kit law: any alias is fine
    comps[NAV2]['position'] = {"x": 1.1, "y": 0.25, "z": 0.9}
    comps += [bridge('sat-link-tetris', -0.6), bridge('sat-link-nav', 0.6)]

    # carry the source's data pipes for the non-app devices (relay, battery,
    # junction, router, screen, chipos), renumbered; app data links are
    # rebuilt through the bridges below.
    pipes = []
    app_src = {TET, NAV}
    for p in src['data']['pipes']:
        a, b = p['a_component'], p['b_component']
        if a in app_src or b in app_src:
            continue
        if a not in REMAP or b not in REMAP:
            continue
        q = dict(p)
        q['a_component'], q['b_component'] = REMAP[a], REMAP[b]
        pipes.append(q)

    # SATELLITE data chain: app -> its DataBridge -> the MiniRouter
    pipes.append(pipe(TET2, 'data-port', BR_TET, 'data-port'))
    pipes.append(pipe(BR_TET, 'data_port.001', ROUTER2, 'data_port.001'))
    pipes.append(pipe(NAV2, 'data-port', BR_NAV, 'data-port'))
    pipes.append(pipe(BR_NAV, 'data_port.002', ROUTER2, 'data_port.002'))
    # power law (the bench convention): the junction feeds both satellites;
    # everything else rode the carried-over pipes
    pipes.append(pipe(JUNC2, 'lowvoltage-port.001', TET2, 'power_connector', 'lowvoltage'))
    pipes.append(pipe(JUNC2, 'lowvoltage-port.002', NAV2, 'power_connector', 'lowvoltage'))

    bp = copy.deepcopy(src)
    bp['data']['alias'] = "Chip Sat Bench"
    bp['author'] = 'satbench'
    bp['data']['components'] = comps
    bp['data']['pipes'] = pipes
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, 'blueprint.json'), 'w') as f:
        json.dump(bp, f, separators=(',', ':'), ensure_ascii=False)
    ids = {c.get('alias') for c in comps}
    need = {'chipos', 'app-tetris', 'app-earthnav', 'sat-link-tetris', 'sat-link-nav'}
    assert need <= ids, f'missing actors: {sorted(need - ids)}'
    print(f"wrote {OUT}: {len(comps)} comps, {len(pipes)} pipes")
    print('aliases:', sorted(c.get('alias', '') for c in comps))


main()
