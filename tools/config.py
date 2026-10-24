#!/usr/bin/env python3
"""Single source of truth for machine-local paths (AGENTS.md § Blueprint folder).

NEVER hardcode a Steam install path (or the repo's own location) in a tool.
Every path outside the repo resolves through this module in three tiers:

  1. environment variable   ARCHEAN_BLUEPRINTS / ARCHEAN_WORKSHOP / ARCHEAN_GAME
  2. repo-root blueprints.conf   KEY=VALUE lines (gitignored; see the .example)
  3. built-in default      (repo testdata/; the usual Steam layout)

blueprints  — the CORPUS: a folder of <workshop-id>/blueprint.json dirs.
              Defaults to <repo>/testdata so a fresh clone works unchanged,
              but the repo itself may live anywhere (it no longer has to sit
              inside the Steam tree) and the corpus may live elsewhere.
workshop_content — Steam client's workshop download dir (add_workshop.py ingest)
game_dir    — Archean-game install with modules/ (extract_models.py source)

The browser suites mirror this: regtest.html takes ?corpus=<url>, and
tests/run_tests.sh honours CORPUS=<url> for the regtest/postest URLs.
"""
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
APPID = '2941660'

DEFAULTS = {
    'blueprints': os.path.join(ROOT, 'testdata'),
    'workshop_content': os.path.expanduser(
        f'~/.local/share/Steam/steamapps/workshop/content/{APPID}'),
    'game_dir': os.path.expanduser(
        '~/.local/share/Steam/steamapps/common/Archean/Archean-game'),
}
ENVVAR = {'blueprints': 'ARCHEAN_BLUEPRINTS',
          'workshop_content': 'ARCHEAN_WORKSHOP',
          'game_dir': 'ARCHEAN_GAME'}


def _conf_file():
    """Parse repo-root blueprints.conf (KEY = VALUE, '#' comments) if present."""
    vals = {}
    p = os.path.join(ROOT, 'blueprints.conf')
    if os.path.isfile(p):
        for line in open(p, encoding='utf-8'):
            line = line.split('#', 1)[0].strip()
            if '=' in line:
                k, _, v = line.partition('=')
                v = v.strip().strip('"').strip("'")
                if v:
                    vals[k.strip().lower()] = v
    return vals


def get(key):
    """Resolve one config key to an absolute path (env > blueprints.conf > default)."""
    env = os.environ.get(ENVVAR[key])
    raw = env or _conf_file().get(key) or DEFAULTS[key]
    raw = os.path.expanduser(raw)
    return raw if os.path.isabs(raw) else os.path.abspath(os.path.join(ROOT, raw))


def blueprints_dir():
    """The blueprint corpus root: contains <workshop-id>/blueprint.json dirs."""
    d = get('blueprints')
    if not os.path.isdir(d):
        raise SystemExit(f'blueprints folder not found: {d}\n'
                         f'set ARCHEAN_BLUEPRINTS or `blueprints = <path>` in blueprints.conf')
    return d


def workshop_content_dir():
    return get('workshop_content')


def game_dir():
    return get('game_dir')


if __name__ == '__main__':   # python3 tools/config.py — print the resolved paths
    for k in ('blueprints', 'workshop_content', 'game_dir'):
        src = ('env ' + ENVVAR[k]) if os.environ.get(ENVVAR[k]) else \
              ('blueprints.conf' if k in _conf_file() else 'default')
        print(f'{k:16} = {get(k)}   ({src})')
