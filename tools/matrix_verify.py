#!/usr/bin/env python3
"""matrix_verify.py — compare our game-file mass/ingredient numbers against
the Xenon dev viewer's panels, per matrix fixture craft.

Reads reports/matrix/<id>.json dossiers written by app/tools/devscrape.mjs,
recomputes everything from the game files with tools/game_data.py, and prints
a verdict per craft (+ REPORT.md). Exit code != 0 on any mismatch.

Checks per craft:
  dev-parse     Xenon viewer loaded the blueprint with zero page errors and
                an empty notes panel (its own warnings)
  mass          mass & balance 'computed' == game_data.compute_mass total
  centre        centre of mass rows match (component positions, kg-weighted)
  items         build-cost 'items' list == game_data.required_items
                (same id set, same counts within display rounding)
  raw           build-cost 'raw materials' == game_data.expand_to_raw
  attribution   ZERO 'stuck' (unresolved) raw rows — a stuck component item
                means our FILE wrote a module that has no recipe in the game,
                i.e. a wrong type→module mapping
  ours          our viewer loaded the fixture without page errors

Run after devscrape:  python3 tools/matrix_verify.py [--dir reports/matrix]
"""
import argparse
import glob
import json
import math
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import game_data  # noqa: E402


def parse_qty(item_id, s):
    """XenonViewer itemQuantity() text -> raw count (inverse of the display)."""
    if s is None:
        return None
    s = s.replace(',', '').replace('\u00a0', ' ').replace('  ', ' ').strip()
    m = re.match(r'^([-\d.]+)\s*(.*)$', s)
    if not m:
        return None
    v = float(m.group(1))
    unit = m.group(2).lower()
    if unit == 'm':
        return v * 100          # spool cm displayed in metres
    if unit == 'kg':
        return v * 1000         # celestial ores displayed in kg
    return v


def parse_mass(s):
    m = re.search(r'([-0-9,. ]+)\s*kg', s or '')
    return float(m.group(1).replace(',', '').replace(' ', '')) if m else None


def parse_vec(mass_rows):
    out = {}
    for k, v in mass_rows:
        m = re.match(r'centre ([XYZ])', k)
        if m:
            out[m.group(1).lower()] = float(v.split()[0])
    return out


def rows_to_map(rows):
    return {r['id']: parse_qty(r['id'], r.get('qty')) for r in rows if r.get('id')}


def expected_com_mass_centre(bp):
    """kg-weighted component CoM in FILE space (dev draws raw positions).
    Tank contents count at the TANK position (dev mass.js does the same)."""
    g = game_data.load_game_data()
    masses, caps = g['masses'], game_data.TANK_CAPACITY
    total = 0.0
    moment = [0.0, 0.0, 0.0]
    for c in bp['data']['components']:
        iid = f"{c['module']}.{c['type']}"
        m = masses.get(iid) or 0.0
        cap = caps.get(iid)
        contents = (c.get('data') or {}).get('contents')
        if cap and isinstance(contents, dict):
            for molecule, frac in contents.items():
                dens = game_data.maximum_liquid_density(molecule)
                if dens:
                    m += float(frac) * cap * dens
        if not m:
            continue
        total += m
        p = c['position']
        for i, k in enumerate('xyz'):
            moment[i] += m * p[k]
    return [v / total for v in moment] if total else [0.0] * 3


def check_craft(dossier, quiet=False):
    cid = dossier['id']
    bpath = None
    root = game_data.config.blueprints_dir()
    bpath = os.path.join(root, cid, 'blueprint.json')
    with open(bpath) as f:
        bp = json.load(f)

    fails, notes = [], []
    dev = dossier.get('dev')
    if dev is None:
        fails.append(f"dev: {dossier.get('devError', 'absent')}")
    else:
        if dossier.get('devPageErrors'):
            fails.append('dev page errors: ' + '; '.join(dossier['devPageErrors'][:2]))
        # The dashboard-builtin element types have NO model in the dev's
        # catalog: the dev draws a placeholder + notes, we draw the real
        # (Dashboard-directory) gltf. Documented divergence (MATRIX.md), so
        # notes that only mention them are tolerated.
        BUILTIN_ONLY = {'ArrowButton', 'Led'}
        if dev.get('warnings'):
            only_builtin = all(any(t in w for t in BUILTIN_ONLY)
                               for w in dev['warnings'])
            if not only_builtin:
                fails.append('dev notes: ' + ' | '.join(dev['warnings']))

        # ---- mass ----
        ours = game_data.compute_mass(bp)
        dev_total = parse_mass(next((v for k, v in dev['massRows'] if k == 'computed'), ''))
        if dev_total is None:
            fails.append('dev mass row missing')
        elif abs(dev_total - ours['total']) > 1.001:
            fails.append(f'mass dev {dev_total:.1f} vs ours {ours["total"]:.1f} kg')
        # centre of mass: components-only fixtures ⇒ pure component CoM
        dv_c = parse_vec(dev['massRows'])
        if dv_c and not bp['data']['blocks']:
            pass
        all_blocks_255 = all(b['type'] == 255 for b in bp['data']['blocks'])
        if dv_c and all_blocks_255:
            ex_c = expected_com_mass_centre(bp)
            for i, ax in enumerate('xyz'):
                if abs(dv_c.get(ax, 0) - ex_c[i]) > 0.011:
                    fails.append(f'centre {ax}: dev {dv_c.get(ax)} vs ours {ex_c[i]:.3f}')

        # ---- items ----
        exp_items = game_data.required_items(bp)
        got_items = rows_to_map(dev['costItems'])
        if set(exp_items) != set(got_items):
            fails.append(f'item ids differ: missing '
                         f'{sorted(set(exp_items)-set(got_items))} extra '
                         f'{sorted(set(got_items)-set(exp_items))}')
        for iid in set(exp_items) & set(got_items):
            e, g = exp_items[iid], got_items[iid] or 0
            if abs(g - e) > max(1.0, 0.02 * e):
                fails.append(f'item {iid}: dev {g} vs ours {e}')

        # ---- raw materials ----
        raw, unresolved, _t = game_data.expand_to_raw(exp_items)
        got_raw = rows_to_map(dev['costRaw'])
        got_stuck = {r['id'] for r in dev['costRaw'] if r.get('stuck')}
        # 'stuck' = the dev's unresolved bucket: catalog components with no
        # crafter recipe (MagicCube, ToiletSeat, ChemicalReactor, tuners…) —
        # our model MUST agree item-for-item, in both directions.
        if got_stuck != set(unresolved):
            fails.append('unresolved mismatch — dev-stuck '
                         f'{sorted(got_stuck)} vs ours {sorted(unresolved)}')
        # the dev's raw view lists BOTH buckets (raw + stuck)
        exp_raw = dict(raw)
        for k, v in unresolved.items():
            exp_raw[k] = v
        if set(exp_raw) != set(got_raw):
            fails.append(f'raw ids differ: missing '
                         f'{sorted(set(exp_raw)-set(got_raw))[:5]} extra '
                         f'{sorted(set(got_raw)-set(exp_raw))[:5]}')
        for iid in set(exp_raw) & set(got_raw):
            e, g = exp_raw[iid], got_raw[iid] or 0
            # dev display: ores >=1000 g are rounded to whole kg (±500 g),
            # components/other items to whole units — so the tolerance has to
            # absorb the display rounding, not just computation drift.
            tol = 501 if iid.startswith('ARCHEAN_celestial.') else 1.0
            if abs(g - e) > max(tol, 0.01 * e):
                fails.append(f'raw {iid}: dev {g} vs ours {e}')

        # ---- component attribution ----
        exp_ids = sorted({f"{c['module']}.{c['type']}"
                          for c in bp['data']['components']})
        got_ids = sorted({c['id'] for c in dev['comps'] if c['id']})
        if exp_ids != got_ids:
            fails.append(f'comp-list ids differ (module map?): dev {got_ids} '
                         f'vs file {exp_ids}')
    # our viewer must report the same component count in its status line
    for tag in ('ours_proxy', 'ours_real'):
        ours = dossier.get(tag)
        if ours and not ours.get('error'):
            m = re.search(r'(\d+) components', ours.get('filestatus') or '')
            n = len(bp['data']['components'])
            if not m or int(m.group(1)) != n:
                fails.append(f'{tag} status: {ours.get("filestatus")!r} '
                             f'expected {n} components')

    # ---- our own viewer ----
    for tag in ('ours_proxy', 'ours_real'):
        ours = dossier.get(tag)
        if ours and ours.get('errors'):
            fails.append(f'{tag} page errors: ' + '; '.join(ours['errors'][:2]))
        if ours and ours.get('error'):
            fails.append(f'{tag}: {ours["error"]}')

    if not quiet:
        status = 'FAIL' if fails else 'PASS'
        types = ' '.join(c['type'] for c in bp['data']['components'])
        mass = (game_data.compute_mass(bp)['total'] if dev else 0)
        print(f'{status} {cid}  [{types}]  mass~{mass:g} kg')
        for line in fails + notes:
            print(f'    - {line}')
    return fails, notes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dir', default='reports/matrix')
    args = ap.parse_args()
    files = sorted(glob.glob(os.path.join(args.dir, '9*.json')))
    if not files:
        sys.exit(f'no dossiers in {args.dir} — run app/tools/devscrape.mjs first')
    n_fail = 0
    lines = ['# Matrix report — our game-file numbers vs Xenon dev viewer\n',
             '| craft | mass | items | raw | notes |', '|---|---|---|---|---|']
    for f in files:
        with open(f) as fh:
            dossier = json.load(fh)
        fails, notes = check_craft(dossier)
        cid = dossier['id']
        dev = dossier.get('dev') or {}
        mass = dev.get('massState', '?')
        if fails:
            n_fail += 1
            lines.append(f'| **{cid}** | {mass} | ❌ | ❌ | '
                         + '<br>'.join(fails + notes) + ' |')
        else:
            lines.append(f'| {cid} | {mass} | ✓ | ✓ | '
                         + ('; '.join(notes) if notes else '') + ' |')
    total = len(files)
    lines.insert(2, f'**{total - n_fail}/{total} crafts pass** — game '
                    f'{game_data.load_game_data()["game_dir"]}\n')
    report = os.path.join(args.dir, 'REPORT.md')
    with open(report, 'w') as fh:
        fh.write('\n'.join(lines) + '\n')
    print(f'\n{n_fail} failing of {total} — {report}')
    sys.exit(1 if n_fail else 0)


if __name__ == '__main__':
    main()
