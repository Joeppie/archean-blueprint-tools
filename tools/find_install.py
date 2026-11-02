#!/usr/bin/env python3
"""Locate an Archean install and its blueprint folders on THIS machine.

Implements the discovery procedure documented in LOCATIONS.md: enumerate
Steam library roots (libraryfolders.vdf + the usual layouts), read
appmanifest_2941660.acf, then probe the install for its two data folders.
Machine-local results NEVER enter the repo: feed them to blueprints.conf
(`--conf` prints paste-ready lines) or the ARCHEAN_* env vars — the three
resolution tiers of tools/config.py.

  python3 tools/find_install.py           # human-readable report
  python3 tools/find_install.py --conf    # blueprints.conf lines only
Exit 0 if the game install or any blueprint root was found.
"""
import os
import re
import sys

APPID = '2941660'   # Archean on Steam (also the workshop content folder name)


def _add(roots, path):
    path = os.path.abspath(os.path.expanduser(path))
    if os.path.isdir(path) and path not in roots:
        roots.append(path)


def library_roots():
    """All Steam library roots visible from this machine (Steam's own vdf
    merged with the usual per-platform Steam roots; STEAM_PATH overrides)."""
    roots = []
    env = os.environ.get('STEAM_PATH')
    if env:
        _add(roots, env)
    cands = []
    if os.name == 'nt':
        for k in ('ProgramFiles(x86)', 'ProgramFiles'):
            v = os.environ.get(k)
            if v:
                cands.append(os.path.join(v, 'Steam'))
        local = os.environ.get('LOCALAPPDATA')
        if local:
            cands.append(os.path.join(local, 'Steam'))
    else:
        home = os.path.expanduser('~')
        cands += [os.path.join(home, '.steam', 'steam'),
                  os.path.join(home, '.steam', 'root'),
                  os.path.join(home, '.local', 'share', 'Steam'),
                  os.path.join(home, '.var', 'app',
                               'com.valvesoftware.Steam', '.local', 'share',
                               'Steam')]
    for steam in cands:
        _add(roots, steam)
        vdf = os.path.join(steam, 'config', 'libraryfolders.vdf')
        if os.path.isfile(vdf):
            with open(vdf, encoding='utf-8', errors='replace') as f:
                for m in re.finditer(r'"path"\s+"([^"]+)"', f.read()):
                    _add(roots, m.group(1))
    return roots


def install_dirs(roots):
    """`steamapps/appmanifest_<APPID>.acf` -> common/<installdir> per library."""
    out = []
    for lib in roots:
        acf = os.path.join(lib, 'steamapps', f'appmanifest_{APPID}.acf')
        if not os.path.isfile(acf):
            continue
        with open(acf, encoding='utf-8', errors='replace') as f:
            m = re.search(r'"installdir"\s+"([^"]+)"', f.read())
        if not m:
            continue
        inst = os.path.join(lib, 'steamapps', 'common', m.group(1))
        if os.path.isdir(inst):
            _add(out, inst)
    # fallback probe (moved/mislabelled installs): marker folders under common/
    for lib in roots:
        common = os.path.join(lib, 'steamapps', 'common')
        if os.path.isdir(common):
            for entry in sorted(os.listdir(common)):
                inst = os.path.join(common, entry)
                if (os.path.isdir(os.path.join(inst, 'Archean-game', 'modules'))
                        or os.path.isdir(os.path.join(
                            inst, 'Archean-data', 'client', 'blueprints'))):
                    _add(out, inst)
    return out


def workshop_dirs(roots):
    out = []
    for lib in roots:
        w = os.path.join(lib, 'steamapps', 'workshop', 'content', APPID)
        if os.path.isdir(w):
            _add(out, w)
    return out


def resolve():
    """Return dict key -> best path for the config.py keys actually found."""
    roots = library_roots()
    found = {}
    for inst in install_dirs(roots):
        game = os.path.join(inst, 'Archean-game')
        bp = os.path.join(inst, 'Archean-data', 'client', 'blueprints')
        if 'game_dir' not in found and os.path.isdir(os.path.join(game, 'modules')):
            found['game_dir'] = game
        if 'blueprints' not in found and os.path.isdir(bp):
            found['blueprints'] = bp
    ws = workshop_dirs(roots)
    if ws:
        found['workshop_content'] = ws[0]
    return found


def main():
    as_conf = '--conf' in sys.argv[1:]
    found = resolve()
    if not as_conf:
        print(f'Steam app id {APPID} (Archean) — resolved on this machine:')
        for k in ('game_dir', 'blueprints', 'workshop_content'):
            print(f'  {k:16} = {found.get(k, "(not found)")}')
        if 'workshop_content' in found:
            n = sum(1 for e in os.listdir(found['workshop_content'])
                    if os.path.isfile(os.path.join(found['workshop_content'],
                                                   e, 'blueprint.json')))
            print(f'  ({n} subscribed craft with blueprint.json)')
        if not found:
            print('Archean install not found; set the paths yourself — see '
                  'LOCATIONS.md')
    else:
        for k, v in found.items():
            print(f'{k} = {v}')
    return 0 if found else 1


if __name__ == '__main__':
    sys.exit(main())
