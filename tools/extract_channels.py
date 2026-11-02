#!/usr/bin/env python3
"""extract_channels.py — pack the game's OWN io-channel meanings for the
Xenon IDE (v1.13.x: "the computer STILL does not resolve the component type
of the input, nor the meaning of the channels per input").

Source (the game's bundled wiki, resolved via tools/config.py `game_dir` —
never a hardcoded path): `wiki/en/components/<cat>/<Type>.md`, the
`### List of inputs` / `### List of outputs` tables

    |Channel|Function|Range|
    |0|Using|1 or the token of the user seated ...|

Semantics (the direction from the COMPUTER's point of view): a component's
"List of outputs" is what it SENDS on its data port — the meaning of
`input_number(io, ch)` when that io is cabled to this type; its "List of
inputs" is what the computer's `output_number(io, ch, v)` writes.

Output: viewer/models/channels.json = {Type: {"in": {ch: {"fn","rng"}},
"out": {...}}}, served as an atlas sibling (models.atlasJsonPaths) next to
economy.json. `--check` re-derives and fails on drift (the extract_economy
ritual)."""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import config  # noqa: E402

OUT = Path(__file__).resolve().parent.parent / 'viewer' / 'models' / 'channels.json'
HEAD = re.compile(r'^#{2,4}\s*List of (inputs|outputs)\s*$', re.I)
ROW = re.compile(r'^\|\s*(\d+)\s*\|([^|]+)\|(?:([^|]*)\|)?')


def build(wiki_dir: Path) -> dict:
    out: dict = {}
    for md in sorted((wiki_dir / 'en' / 'components').rglob('*.md')):
        typ = md.stem
        text = md.read_text(encoding='utf-8', errors='replace')
        lines = text.split('\n')
        cur = None
        table: dict = {}
        entries: dict = {}

        def flush():
            if cur and table:
                entries[cur] = dict(sorted(table.items()))

        for ln in lines:
            h = HEAD.match(ln.strip())
            if h:
                flush()
                cur = 'in' if h.group(1).lower().startswith('i') else 'out'
                table = {}
                continue
            if cur:
                m = ROW.match(ln.strip())
                if m:
                    table[int(m.group(1))] = {'fn': m.group(2).strip(),
                                              'rng': (m.group(3) or '').strip()}
                elif ln.strip() and not ln.strip().startswith('|'):
                    flush()
                    cur, table = None, {}
        flush()
        if entries:
            out[typ] = entries
    return out


def main() -> int:
    g = config.game_dir()
    check = '--check' in sys.argv
    data = {}
    if g:
        data = build(Path(g) / 'wiki')               # Archean-game/wiki
    if not data:
        print('no wiki found (set ARCHEAN_GAME / blueprints.conf)', file=sys.stderr)
        return 1
    text = json.dumps(data, ensure_ascii=False, sort_keys=True, indent=1)
    if check:
        cur = OUT.read_text(encoding='utf-8') if OUT.exists() else ''
        if cur.strip() != text.strip():
            print('channels.json is STALE vs the game wiki — re-run', file=sys.stderr)
            return 1
        print(f'channels.json current ({len(data)} types)')
        return 0
    OUT.write_text(text + '\n', encoding='utf-8')
    n_in = sum(1 for v in data.values() if 'in' in v)
    n_out = sum(1 for v in data.values() if 'out' in v)
    print(f'{OUT} ← {len(data)} types ({n_in} with inputs, {n_out} with outputs)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
