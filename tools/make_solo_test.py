#!/usr/bin/env python3
"""Generate SOLO component fixtures into the blueprint corpus.

One component per craft (type alphabetically indexed), centred at x=+0.125,
y=z=+0.125, identity file quaternion, nothing else but its occupancy cell —
the geometry-space question ("does this component's content render like the
XenonViewer's?") with zero occluders and zero orientation conventions. The
pairing routine `app/tools/solopair.mjs` renders each craft in BOTH viewers
at the dev's iso angle and diffs the renders + per-part local boxes.

Ids: 90000030NN (01..NN = sorted atlas manifest types). Payload `data` reuses
make_matrix_test.REST_DATA (curated from real 2026 corpus files).

Deterministic:  python3 tools/make_solo_test.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import config                                   # noqa: E402
import make_matrix_test as mmt                  # noqa: E402


def main():
    root = config.blueprints_dir()
    models_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                              'viewer', 'models')
    manifest = json.load(open(os.path.join(models_dir, 'manifest.json')))
    written = []
    for i, t in enumerate(sorted(manifest), start=1):
        craft_id = 9000003000 + i
        module = manifest[t].get('module', 'ARCHEAN_parts')
        comp = mmt.component(t, module, 0.125, dict(mmt.REST_DATA.get(t, {})))
        bp = mmt.craft(craft_id, 0, [comp], t)
        d = os.path.join(root, str(craft_id))
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, 'blueprint.json'), 'w') as f:
            json.dump(bp, f, separators=(',', ':'), ensure_ascii=False)
        written.append((craft_id, t))
    print(f'{len(written)} solo fixtures under {root}')
    print('id map: ' + ', '.join(f'{i}={t}' for i, t in written[:6]) + ', …')


if __name__ == '__main__':
    main()
