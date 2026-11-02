#!/usr/bin/env python3
"""extract_economy.py — pack the game's crafting ECONOMY for the app's cost view.

The app is a static site: it cannot read the installed game at runtime, so the
crafter recipes (items -> raw ores/molecules) are extracted once and shipped as
`viewer/models/economy.json`, the sibling of the model atlas
(tools/extract_models.py) and resolved through the same base candidates
(app/src/engine/economy.ts).

Source = the same tables tools/game_data.py uses (the dev viewer's cost panel
agrees with them — see MATRIX.md / tools/matrix_verify.py):
  modules/<module>/config.yaml   items + crafter recipes

Output shape (all numbers as the game stores them — recipe quantities, where
celestial ores are GRAMS):

  {
    "recipes":   {"<item id>": {"out": 1, "in": {"<item id>": qty}, "time": s}},
    "components": ["<module>.<Type>", ...]     # the component catalog ids
  }

Only `context: crafter` recipes are kept (the first one per output wins — the
game's own unfold rule, game_data.craft_index); everything else
(smelting/crusher/etc.) is NOT part of the Blueprint tool's raw-material cost.

Usage:
    python3 tools/extract_economy.py [-o viewer/models/economy.json]

Game version drift: re-run this (and the matrix suite) whenever the game
updates — the recipes ARE game data, exactly like the model atlas.
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import config      # noqa: E402
import game_data   # noqa: E402


def build_economy():
    """{recipes, components} from the installed game (first crafter recipe wins)."""
    data = game_data.load_game_data()
    recipes = {}
    for r in data['recipes']:
        if r.get('context') != 'crafter':
            continue
        for iid, qty in (r.get('output') or {}).items():
            if not qty or qty <= 0 or iid in recipes:
                continue                       # FIRST recipe per output wins
            recipes[iid] = {
                'out': qty,
                'in': {k: v for k, v in (r.get('input') or {}).items() if v},
                'time': r.get('time') or 0,
            }
    components = sorted(c for c in data['comp_ids']
                        # directory names that are not component types
                        # (stray assets such as HDD.png / *.ini live in the
                        # module tree and must never become catalog ids)
                        if '.' not in c.split('.', 1)[1]
                        and c.split('.', 1)[1][:1].isupper())
    return {'recipes': dict(sorted(recipes.items())),
            'components': components}


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('-o', '--out', default=os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        'viewer', 'models', 'economy.json'))
    ap.add_argument('--check', action='store_true',
                    help='do not write; fail if the file on disk is stale')
    args = ap.parse_args()

    econ = build_economy()
    text = json.dumps(econ, separators=(',', ':'), sort_keys=True) + '\n'
    if args.check:
        try:
            with open(args.out, encoding='utf-8') as f:
                cur = f.read()
        except FileNotFoundError:
            sys.exit(f'{args.out}: MISSING — run tools/extract_economy.py')
        if cur != text:
            sys.exit(f'{args.out}: STALE vs the installed game — '
                     f'run tools/extract_economy.py')
        print(f'{args.out}: up to date '
              f'({len(econ["recipes"])} recipes, {len(econ["components"])} components)')
        return
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, 'w', encoding='utf-8') as f:
        f.write(text)
    print(f'wrote {args.out}: {len(econ["recipes"])} crafter recipes, '
          f'{len(econ["components"])} catalog components '
          f'({os.path.getsize(args.out) / 1024:.1f} kB)')


if __name__ == '__main__':
    main()
