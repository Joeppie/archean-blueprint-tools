#!/usr/bin/env python3
"""game_data.py — mass & ingredients straight from an installed Archean game.

Two authoritative sources inside ARCHEAN_GAME (tools/config.py):
  * modules/<module>/components/<Type>/<Type>.ini   [ENTITY] mass = kg
  * modules/<module>/config.yaml                    items + craft recipes

From those, this module reproduces the two numbers the game's own editor
tooling shows for any blueprint:

  required_items(bp)   — the Blueprint tool's "what do I need to place this"
                         list (= game GetBlueprintContents, ARCHEAN_build/
                         common.hh): every block costs its FULL rect of the
                         material's block item (shape does not matter),
                         triangles cost ceil(volume) >= 1 block, struts 100
                         steel rods per metre (ceil), spool cables truncate
                         SEGMENT BY SEGMENT (2x 1.5 cm segments cost 2 cm,
                         not 3), frames cost one SteelBeam each, components
                         cost 1 item (module taken from the FILE), the Build
                         ghost is dropped and a Dashboard is replaced by one
                         DashboardTool.
  expand_to_raw(items) — recursive crafter-recipe unfold to ores/molecules
                         (= game RepairEconomy.h): first crafter recipe that
                         outputs an item wins; quantity/recipe-output batches
                         may be fractional; an item with no recipe is either
                         raw (terminal) or unresolved (it IS a catalog
                         component, or a cyclic recipe entry).
  compute_mass(bp)     — server mass model (MaterialProperties.hh): density
                         per 0.25 m cell cube [composite .25, concrete 10,
                         steel 1, aluminium .5, glass 1, lead 150, titanium
                         .6], non-cube blocks cost HALF their rect, hull
                         triangles area*0.05 m, struts 1 kg/m, frame beams
                         10 kg, components their ini mass, tanks their
                         contents fraction * capacity * the game's "very
                         crude" liquid density (mass/atom³-radius formula).

The companion suite (tools/make_matrix_test.py + app/tools/devscrape.mjs +
tools/matrix_verify.py) cross-checks these numbers against the dev's
XenonViewer panels — see MATRIX.md. These tables are GAME VERSION DATA:
re-run the matrix suite whenever the game updates (the dev's own catalog is
regenerated on their own schedule, so a mismatch is expected drift, not
automatically a bug either side).

CLI:  tools/game_data.py --selfcheck testdata/ISW-241/blueprint.json
      tools/game_data.py --list-recipes | --mass <Type> | --recipe <id>
"""
import json
import math
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import config  # noqa: E402

try:
    import yaml
except ImportError:  # pragma: no cover
    sys.exit("game_data.py needs PyYAML (python3 -m pip install pyyaml)")

CELL = 0.25
OCCUPANCY_TYPE = 255
TRIANGLE_THICKNESS = 0.05
CELL_VOLUME = CELL ** 3
BEAM_MASS = 10.0                      # kg per frame beam
STRUT_KG_PER_M = 1.0                  # steel rod, 10 g each, 100 per metre
DENSITY = [0.25, 10.0, 1.0, 0.5, 1.0, 150.0, 0.6]   # material 0..6, per cell cube
BLOCK_ITEMS = ['CompositeBlock', 'ConcreteBlock', 'SteelBlock',
               'AluminiumBlock', 'GlassBlock', 'LeadBlock', 'TitaniumBlock']
PIPE_ITEMS = {'data': 'DataCable', 'lowvoltage': 'LowVoltageCable',
              'highvoltage': 'HighVoltageCable', 'fluid': 'FluidPipe',
              'item': 'ItemConduit'}
BUILD = 'ARCHEAN_build'
TANK_CAPACITY = {                     # m3, ARCHEAN_tank_server.cpp
    'ARCHEAN_tank.FluidTank': 1.5,
    'ARCHEAN_tank.SmallFluidTank': 0.2,
    'ARCHEAN_tank.BigFluidTank': 14,
}
# game Chemistry.cpp atomic masses (u)
ATOMIC_MASS = {
    'H': 1.008, 'He': 4.003, 'Li': 6.941, 'Be': 9.012, 'B': 10.811, 'C': 12.011,
    'N': 14.007, 'O': 15.999, 'F': 18.998, 'Ne': 20.180, 'Na': 22.990,
    'Mg': 24.305, 'Al': 26.982, 'Si': 28.085, 'P': 30.974, 'S': 32.06,
    'Cl': 35.45, 'Ar': 39.948, 'K': 39.098, 'Ca': 40.078, 'Ti': 47.867,
    'Fe': 55.845, 'Ni': 58.693, 'Cu': 63.546, 'Zn': 65.38, 'Ag': 107.87,
    'Sn': 118.71, 'Pt': 195.08, 'Au': 196.97, 'Hg': 200.59, 'Pb': 207.2,
    'U': 238.03,
}
ATOMIC_MASS_TO_KG = 1.6605402e-27

_cache = {}


def _ini_entity_mass(path):
    """[ENTITY] mass = X of a component .ini (None if absent)."""
    in_entity = False
    with open(path, encoding='utf-8', errors='replace') as f:
        for line in f:
            line = line.strip()
            if line.startswith('['):
                in_entity = line.upper().startswith('[ENTITY')
            elif in_entity and line.lower().startswith('mass'):
                m = re.match(r'mass\s*=\s*([-+0-9.eE]+)', line)
                if m:
                    return float(m.group(1))
    return None


def _qty_map(v):
    """Normalize a recipe input/output: dict, a bare item string (=1), None.

    Dynamic amounts ('input.composition.Fe' shorthand, crusher recipes) are
    dropped: they cannot be evaluated without an actual stack, and they are
    never part of the crafter unfold the Blueprint tool cost uses.
    """
    if not v:
        return {}
    if isinstance(v, str):
        return {v: 1}
    out = {}
    for k, q in v.items():
        if isinstance(q, (int, float)):
            out[k] = q
    return out


def load_game_data():
    """Parse the installed game: items, crafter recipes, component masses."""
    if 'data' in _cache:
        return _cache['data']
    gdir = config.game_dir()
    mods_dir = os.path.join(gdir, 'modules') if gdir else None
    if not mods_dir or not os.path.isdir(mods_dir):
        sys.exit(f'game_dir not found ({gdir}) — see tools/config.py / LOCATIONS.md')
    items = {}       # id -> {max_stack}
    recipes = []     # {module, label, context, category, time, input, output}
    masses = {}      # id -> kg
    comp_ids = {}    # Type -> module (first module dir hosting the component)
    for mod in sorted(os.listdir(mods_dir)):
        cfg = os.path.join(mods_dir, mod, 'config.yaml')
        if os.path.exists(cfg):
            with open(cfg, encoding='utf-8') as f:
                doc = yaml.safe_load(f) or {}
            for iid, ent in (doc.get('items') or {}).items():
                items[iid] = {'max_stack': (ent or {}).get('max_stack', 256)}
            for r in (doc.get('recipes') or []):
                recipes.append({
                    'module': mod, 'label': r.get('label'),
                    'context': r.get('context'), 'category': r.get('category'),
                    'time': r.get('time', 0),
                    'input': _qty_map(r.get('input')),
                    'output': _qty_map(r.get('output')),
                })
        comp = os.path.join(mods_dir, mod, 'components')
        if os.path.isdir(comp):
            for t in sorted(os.listdir(comp)):
                ini = os.path.join(comp, t, f'{t}.ini')
                iid = f'{mod}.{t}'
                if iid not in comp_ids:
                    comp_ids[iid] = mod
                if os.path.exists(ini):
                    m = _ini_entity_mass(ini)
                    if m is not None:
                        masses[iid] = m
    data = {'game_dir': gdir, 'items': items, 'recipes': recipes,
            'masses': masses, 'comp_ids': comp_ids}
    _cache['data'] = data
    return data


# ---------- blueprint side ----------

def _tri_pts(tri):
    """The triangle's three lattice points (ints).

    The FILE stores them FLAT as v0_x/v0_y/v0_z … v2_z (FORMAT §Triangles);
    older tooling assumed a nested 'v' array, which no corpus file carries —
    keeping that assumption made every craft with a hull skin crash here.
    """
    if 'v' in tri:
        return tri['v']
    return [[tri[f'v{i}_{ax}'] for ax in 'xyz'] for i in range(3)]


def _tri_area_m2(v):
    """Hull-triangle area in m² from lattice ints (world pitch = CELL).

    The frame offsets (12·f·CELL − 1.5) cancel in the edge differences, so
    the pitch alone maps lattice ints to metres.
    """
    ax = (v[1][0] - v[0][0]) * CELL; ay = (v[1][1] - v[0][1]) * CELL
    az = (v[1][2] - v[0][2]) * CELL
    bx = (v[2][0] - v[0][0]) * CELL; by = (v[2][1] - v[0][1]) * CELL
    bz = (v[2][2] - v[0][2]) * CELL
    cx = ay * bz - az * by
    cy = az * bx - ax * bz
    cz = ax * by - ay * bx
    return 0.5 * math.sqrt(cx * cx + cy * cy + cz * cz)


def _strut_length(s):
    """Strut length in m. MODERN files store the endpoints in METRES relative
    to the frame corner; LEGACY ones in lattice CELLS and are recognised by an
    integer v0_x < 32 (the dev viewer's own compatibility probe,
    js/blueprint.js — transcribed in FORMAT §Struts). The frame offset cancels
    in the difference, so only the scale matters here."""
    v0x = s.get('v0_x')
    legacy = (isinstance(v0x, (int, float)) and float(v0x).is_integer()
              and abs(v0x) < 32)
    k = CELL if legacy else 1.0
    return math.sqrt(sum(((s[f'v1_{ax}'] - s[f'v0_{ax}']) * k) ** 2 for ax in 'xyz'))


def _frame_beams(bp):
    """SteelBeam count: a frame record is a 3 m cube carrying up to 12 beams
    (the `beams` flags) — ONE beam item per lit flag, not per frame record."""
    return sum(sum(1 for b in (f.get('beams') or []) if b)
               for f in (bp['data'].get('frames') or []))


def required_items(bp):
    """Blueprint-tool content list: item id -> count (GetBlueprintContents).

    SUBGRID CONTENT IS COUNTED: a Build's nested blueprint is flattened in
    (its parts are material you still have to craft — only the Build
    construction GHOST itself is dropped, at every level). The dev viewer's
    cost panel has never been compared on a craft carrying nested parts
    (the matrix fixtures are component-only), so this rule follows the
    material logic, not a scrape — pinned by app/src/engine/__tests__/
    economy.test.ts on the same fixture the app's VIEW ▸ Component cost shows.
    """
    data = load_game_data()
    items = {}

    def add(iid, count):
        if count and count > 0:
            items[iid] = items.get(iid, 0) + count

    d = bp['data']
    add(f'{BUILD}.SteelBeam', _frame_beams(bp))
    for b in d.get('blocks') or []:
        if b['type'] == OCCUPANCY_TYPE:
            continue
        count = (b['size_x'] + 1) * (b['size_y'] + 1) * (b['size_z'] + 1)
        mat = b.get('material', 0)
        add(f'{BUILD}.{BLOCK_ITEMS[mat] if 0 <= mat < len(BLOCK_ITEMS) else BLOCK_ITEMS[0]}',
            count)
    for tri in d.get('triangles') or []:
        cells = _tri_area_m2(_tri_pts(tri)) * TRIANGLE_THICKNESS / CELL_VOLUME
        mat = tri.get('material', 0)
        add(f'{BUILD}.{BLOCK_ITEMS[mat] if 0 <= mat < len(BLOCK_ITEMS) else BLOCK_ITEMS[0]}',
            max(math.ceil(cells), 1))
    for s in d.get('struts') or []:
        add(f'{BUILD}.SteelRod', math.ceil(_strut_length(s) * 100))
    for p in d.get('pipes') or []:
        item = PIPE_ITEMS.get(p.get('type'))
        if not item:
            continue
        for seg in p.get('segments') or []:
            # the game truncates PER SEGMENT (2x1.5cm segments cost 2, not 3)
            add(f'{BUILD}.{item}', int(seg['length'] * 100))

    def add_components(comps):
        for c in comps or []:
            if c.get('type') == 'Build':
                add_components((c.get('data') or {}).get('components'))
                continue
            add(f"{c['module']}.{c['type']}", 1)

    add_components(d.get('components'))
    items.pop(f'{BUILD}.Build', None)      # subgrid ghosts are never an item
    if f'{BUILD}.Dashboard' in items:      # dashboards arrive by their tool
        items.pop(f'{BUILD}.Dashboard')
        add(f'{BUILD}.DashboardTool', 1)
    _ = data
    return items


def craft_index():
    """item id -> (recipe, output qty): FIRST crafter recipe wins."""
    idx = {}
    for r in load_game_data()['recipes']:
        if r.get('context') != 'crafter':
            continue
        for iid, q in (r.get('output') or {}).items():
            if q and q > 0 and iid not in idx:
                idx[iid] = (r, q)
    return idx


def expand_to_raw(items):
    """Unfold item counts through crafter recipes -> (raw, unresolved, time)."""
    idx = craft_index()
    catalog_ids = set(load_game_data()['comp_ids'])
    raw, unresolved = {}, {}
    total_time = [0.0]

    def visit(iid, qty, seen):
        entry = idx.get(iid)
        if entry is None or iid in seen:
            stuck = entry is not None or iid in catalog_ids
            (unresolved if stuck else raw)[iid] = \
                (unresolved if stuck else raw).get(iid, 0) + qty
            return
        recipe, out_qty = entry
        batches = qty / out_qty
        total_time[0] += (recipe.get('time') or 0) * batches
        for iid_in, amt in (recipe.get('input') or {}).items():
            visit(iid_in, amt * batches, seen | {iid})

    for iid, qty in items.items():
        visit(iid, qty, frozenset())
    return raw, unresolved, total_time[0]


def _parse_formula(formula):
    counts = {}
    cleaned = re.sub(r'\((\w+?)\d+\)', r'\1', str(formula))
    for m in re.finditer(r'([A-Z][a-z]?)(\d*)', cleaned):
        if not m.group(1):
            continue
        counts[m.group(1)] = counts.get(m.group(1), 0) + \
            (int(m.group(2)) if m.group(2) else 1)
    return counts


def maximum_liquid_density(formula):
    """The game's own 'very crude approximation' (Chemistry.cpp) — kg/m³."""
    counts = _parse_formula(formula)
    mass = volume = 0.0
    for el, n in counts.items():
        atomic = ATOMIC_MASS.get(el)
        if atomic is None:
            return None
        mass += atomic * n
        volume += (4 / 3) * math.pi * (0.92e-10 * n) ** 3
    return mass * ATOMIC_MASS_TO_KG / volume if volume > 0 else None


def compute_mass(bp):
    """Server mass model: {total, declared, by_family, missing} (kg)."""
    masses = load_game_data()['masses']
    d = bp['data']
    fam = dict.fromkeys(['blocks', 'triangles', 'struts', 'frames',
                         'components', 'fluids'], 0.0)
    missing = set()
    for b in d.get('blocks') or []:
        if b['type'] == OCCUPANCY_TYPE:
            continue
        vol = (b['size_x'] + 1) * (b['size_y'] + 1) * (b['size_z'] + 1)
        if b['type'] != 0:
            vol *= 0.5                      # any shaped block costs half
        mat = b.get('material', 0)
        fam['blocks'] += vol * (DENSITY[mat] if 0 <= mat < len(DENSITY) else 1.0)
    for tri in d.get('triangles') or []:
        mat = tri.get('material', 0)
        fam['triangles'] += (_tri_area_m2(_tri_pts(tri)) * TRIANGLE_THICKNESS /
                             CELL_VOLUME) * (DENSITY[mat] if 0 <= mat < len(DENSITY) else 1.0)
    for s in d.get('struts') or []:
        fam['struts'] += STRUT_KG_PER_M * _strut_length(s)
    fam['frames'] = BEAM_MASS * _frame_beams(bp)
    for c in d.get('components') or []:
        iid = f"{c['module']}.{c['type']}"
        m = masses.get(iid)
        if m:
            fam['components'] += m
        elif iid not in load_game_data()['comp_ids']:
            # dev semantics: a catalog part with no mass (Dashboard, or the
            # dashboard-builtin ArrowButton/Led) contributes 0 and is NOT
            # 'missing'; only ids absent from the component catalog are
            missing.add(iid)
        cap = TANK_CAPACITY.get(iid)
        contents = (c.get('data') or {}).get('contents')
        if cap and isinstance(contents, dict):
            for molecule, frac in contents.items():
                dens = maximum_liquid_density(molecule)
                if dens is None:
                    missing.add(molecule)
                    continue
                fam['fluids'] += float(frac) * cap * dens
    total = sum(fam.values())
    return {'total': total, 'by_family': fam, 'missing': sorted(missing),
            'declared': bp.get('mass')}


# ---------- CLI ----------

def main():
    import argparse
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--list-recipes', action='store_true')
    ap.add_argument('--recipe', metavar='ID', help='crafter recipe producing ID')
    ap.add_argument('--mass', metavar='TYPE', help='component mass by type name')
    ap.add_argument('--selfcheck', metavar='BLUEPRINT.json')
    args = ap.parse_args()
    g = load_game_data()
    if args.list_recipes:
        for r in g['recipes']:
            out = ','.join(f'{k}x{v}' for k, v in r['output'].items())
            print(f"[{r['context']}/{r['category']}] {out} <- " +
                  ' + '.join(f'{k}x{v}' for k, v in r['input'].items()))
        return
    if args.recipe:
        for r in g['recipes']:
            if args.recipe in r['output']:
                print(json.dumps(r, indent=2))
        return
    if args.mass:
        for iid, m in sorted(g['masses'].items()):
            if iid.endswith('.' + args.mass):
                print(f'{iid} = {m} kg')
        return
    if args.selfcheck:
        with open(args.selfcheck) as f:
            bp = json.load(f)
        items = required_items(bp)
        raw, unresolved, t = expand_to_raw(items)
        mass = compute_mass(bp)
        print(f'--- {args.selfcheck}')
        print(f'mass: computed {mass["total"]:.1f} kg | declared {mass["declared"]} '
              f'| families { {k: round(v,1) for k,v in mass["by_family"].items()} }')
        if mass['missing']:
            print('MISSING from game data:', mass['missing'])
        print(f'items ({len(items)}):')
        for iid, q in sorted(items.items(), key=lambda kv: -kv[1]):
            print(f'  {q:>10}  {iid}')
        print(f'raw ({len(raw)}) craft-time {t/3600:.1f} h:')
        for iid, q in sorted(raw.items(), key=lambda kv: -kv[1]):
            print(f'  {q:>10.1f}  {iid}')
        if unresolved:
            print('UNRESOLVED:', unresolved)
        return
    ap.print_help()


if __name__ == '__main__':
    main()
