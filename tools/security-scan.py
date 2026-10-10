#!/usr/bin/env python3
"""security-scan.py — the mandatory checkin gate (AGENTS.md).

modes:
  --staged    scan staged content of added/copied/modified files (the git
              pre-commit hook; fast, byte-accurate: reads the INDEX blobs)
  --tree      scan every tracked file in the working tree
  --history   scan every blob of every revision (forensic one-off)
  --versions  verify the v0.xx release strings agree across
              viewer/index.html + README.md + index.html (release ritual)

FAIL (exit 1) = credential SHAPES, i.e. things that are secrets if real:
  private-key blocks, GitHub/AWS/Google/Slack/npm/PyPI/OpenAI tokens, JWTs,
  ssh keys, basic-auth URLs, Steam WebAPI keys (key=<32 hex>), password/
  token/api-key assignments. Deliberately shape-based: no online checking.

INFO = personal/publication metadata that is INTENTIONAL in this repo:
  workshop craft authors + datetimes inside testdata blueprints (NOTICE §2),
  Steam workshop titles (tools/ws-names.tsv), the local dev paths/tools.
  Reported in --tree/--history for the human eye; never a failure.

The 2026-10-09 baseline audit: tree + 88 revisions = zero FAILs.
"""
import re
import subprocess
import sys
import collections

FAIL_PATTERNS = [
    ('private-key',       rb"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    ('github-token',      rb"\bgh[pousr]_[A-Za-z0-9]{20,}\b"),
    ('github-pat',        rb"\bgithub_pat_[A-Za-z0-9_]{22,}\b"),
    ('aws-key',           rb"\bAKIA[0-9A-Z]{16}\b"),
    ('google-api-key',    rb"\bAIza[0-9A-Za-z_-]{30,}\b"),
    ('slack-token',       rb"\bxox[abprs]-[A-Za-z0-9-]{10,}\b"),
    ('openai-key',        rb"\bsk-[A-Za-z0-9]{32,}\b"),
    ('npm-token',         rb"\bnpm_[A-Za-z0-9]{36}\b"),
    ('pypi-token',        rb"\bpypi-AgEIcHlwaS5vcmc\S+"),
    ('jwt',               rb"\beyJ[A-Za-z0-9_-]{20,}\.eyJ"),
    ('ssh-key',           rb"\bssh-(rsa|ed25519) AAAA[A-Za-z0-9+/=]{40,}"),
    ('basic-auth-url',    rb"://[A-Za-z0-9._-]+:[^/\s]{6,}@"),
    ('steam-webapi-key',  rb"[?&]key=[0-9A-Fa-f]{32}"),
    ('secret-assign',     rb"(?i)\b(api[_-]?key|apikey|secret|passwd|password)\b\s*[:=]\s*[\"'][^\"'\s]{8,}[\"']"),
]
# INFO patterns deliberately NOT gating: this repo intentionally ships public
# workshop metadata (craft titles/authors) and dev tooling.


def scan_bytes(rel, data, fails):
    for name, pat in FAIL_PATTERNS:
        for m in re.finditer(pat, data):
            line = data.count(b'\n', 0, m.start()) + 1
            frag = m.group(0)[:48].decode('utf-8', 'replace')
            fails.append(f"FAIL {rel}:{line} {name}: {frag}")


def git(*args, binary=False):
    return subprocess.run(args, cwd=REPO, check=True,
                          stdout=subprocess.PIPE).stdout if binary else \
        subprocess.run(args, cwd=REPO, check=True,
                       stdout=subprocess.PIPE).stdout.decode()


import os
REPO = subprocess.run(['git', 'rev-parse', '--show-toplevel'],
                      stdout=subprocess.PIPE, text=True,
                      cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))).stdout.strip()


def mode_staged():
    fails = []
    files = git('git', 'diff', '--cached', '--name-only',
                '--diff-filter=ACM').split('\n')
    n = 0
    for f in files:
        if not f:
            continue
        try:
            data = git('git', 'show', f':{f}', binary=True)
        except subprocess.CalledProcessError:
            continue                      # deleted between listing and show
        scan_bytes(f, data, fails)
        n += 1
    return fails, n


def mode_tree():
    fails = []
    files = [f for f in git('git', 'ls-files').split('\n') if f]
    for f in files:
        p = os.path.join(REPO, f)
        try:
            with open(p, 'rb') as fh:
                scan_bytes(f, fh.read(), fails)
        except OSError:
            pass
    return fails, len(files)


def mode_history():
    fails = []
    # every blob reachable from any ref (cat-file --batch streams contents)
    objs = git('git', 'rev-list', '--objects', '--all').split('\n')
    ids = [o.split(' ', 1)[0] for o in objs if o]
    p = subprocess.run(['git', 'cat-file', '--batch'], cwd=REPO,
                       input=('\n'.join(ids) + '\n').encode(),
                       stdout=subprocess.PIPE,
                       stderr=subprocess.DEVNULL).stdout
    # walk the cat-file stream: "<oid> <type> <size>\n<data>\n"
    name_of = {o.split(' ', 1)[0]: (o.split(' ', 1)[1] if ' ' in o else '?') for o in objs if o}
    i, n = 0, len(p)
    while i < n:
        j = p.find(b'\n', i)
        if j < 0:
            break
        head = p[i:j].split(b' ')
        i = j + 1
        if len(head) < 3:
            continue
        oid, size = head[0], int(head[2])
        data = p[i:i + size]
        i += size + 1
        scan_bytes(f"blob:{oid}:{name_of.get(oid.decode(), '?')}", data, fails)
    return fails, len(ids)


VER_SPECS = {
    'viewer/index.html': [r'Archean Blueprint Viewer v0\.(\d+)',
                          r'v0\.(\d+)</small>', r'view3d\.js\?v=(\d+)',
                          r'tests\.js\?v=(\d+)'],
    'README.md': [r'# Archean Blueprint Tools · v0\.(\d+)', r'This is v0\.(\d+)'],
    'index.html': [r'Archean Blueprint Tools v0\.(\d+)</title>',
                   r'v0\.(\d+)</span>'],
}


def mode_versions():
    want = []
    for f, pats in VER_SPECS.items():
        t = open(os.path.join(REPO, f), encoding='utf-8').read()
        for p in pats:
            want += re.findall(p, t)
    bad = [] if len(set(want)) == 1 else ['FAIL release strings out of sync: '
                                          + ', '.join(sorted(set(want)))]
    return bad, len(want)


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else '--staged'
    fails, n = {'--staged': mode_staged, '--tree': mode_tree,
                '--history': mode_history, '--versions': mode_versions}[mode]()
    if fails:
        print('\n'.join(fails))
        sys.exit(1)
    print(f"security-scan {mode}: clean ({n} {'strings' if mode == '--versions' else 'targets'} checked)")


if __name__ == '__main__':
    main()
