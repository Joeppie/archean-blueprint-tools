#!/usr/bin/env python3
"""deploy_pages.py — publish the PUBLIC site (GitHub Pages) from a release.

The site is the GENERATED `pages` branch: an orphan snapshot of the release
tree where the built SPA (app/dist) is shipped at the SITE ROOT — the app IS
the site (2026-10-19 user rule: the old viewer is retired to a small link at
the end of the app's gallery) — plus an `/app/` redirect stub:

    /                              THE APP: craft gallery + 3D editor
    /assets/<hash>.js|.css         the app bundle (merges with repo assets/)
    /testdata/<id>/blueprint.json  corpus the app fetches
    /viewer/models/<Type>.json     game model atlas (app BASES fallback)
    /viewer/index.html             the RETIRED legacy viewer (footer link)
    /app/index.html                redirect stub (old deep links → root)

The app resolves every data route RELATIVE to the page (app/src/crafts.ts,
app/src/engine/models.ts, the gallery preview URLs), so the build carries NO
machine paths — but it must be built with the corpus PINNED to the repo
testdata (ARCHEAN_BLUEPRINTS), or the compiled gallery catalog would mirror
this machine's private Steam corpus into the public bundle.

Purity: the build happens inside a DETACHED worktree of the release ref, with
its own `npm ci` (AGENTS: NEVER symlink node_modules between checkouts), so
what ships is exactly the release commit — never an uncommitted edit.

Usage:
    tools/deploy_pages.py                 # deploy origin/release (default)
    tools/deploy_pages.py --ref <ref>     # deploy another ref (dry-run aid)
    tools/deploy_pages.py --dry-run       # build + assemble, no push

The branch is FORCE-PUSHED every run: `pages` is generated, never hand-edited
(its history is disposable; the source of truth is the release ref).

After the push, Pages rebuilds automatically IF its source is the `pages`
branch (one-time setup, see AGENTS.md § Publishing; rollback = flip the source
back to `release`).
"""
import argparse
import os
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(__file__))
import config

ROOT = config.ROOT
AP = subprocess.run


def run(*args, cwd=None, env=None, capture=False):
    print('+', ' '.join(args), f'(cwd={os.path.relpath(cwd or ROOT, ROOT)})')
    r = subprocess.run(args, cwd=cwd or ROOT, env=env,
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if r.returncode != 0:
        print(r.stdout)
        sys.exit(f'deploy: FAILED: {" ".join(args)} (rc={r.returncode})')
    return r.stdout or ''


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--ref', default='origin/release',
                    help='git ref to publish (default origin/release — run '
                         'tools/release.sh first to move it)')
    ap.add_argument('--dry-run', action='store_true',
                    help='build + assemble + report, but do not push')
    args = ap.parse_args()

    if subprocess.run(['git', 'status', '--porcelain'], cwd=ROOT,
                      stdout=subprocess.PIPE, text=True).stdout.strip():
        sys.exit('deploy: REFUSED — working tree is dirty (the build must be '
                 'reproducible from the ref, not from local edits)')
    run('git', 'fetch', '--quiet', 'origin', 'refs/heads/*:refs/remotes/origin/*')
    ref_sha = run('git', 'rev-parse', args.ref, capture=True).strip()
    print(f'deploy: publishing {args.ref} = {ref_sha[:8]}')

    tmp = tempfile.mkdtemp(prefix='archean-pages-', dir='/tmp/opencode')
    wt = os.path.join(tmp, 'site')
    try:
        # ---------- pure build of the ref itself ----------
        run('git', 'worktree', 'add', '--detach', wt, ref_sha)
        if shutil.which('npm') is None:
            sys.exit('deploy: npm not found')
        run('npm', '--prefix', 'app', 'ci', '--no-audit', '--no-fund', cwd=wt)
        env = dict(os.environ, ARCHEAN_BLUEPRINTS=os.path.join(wt, 'testdata'))
        run('npm', '--prefix', 'app', 'run', 'build', cwd=wt, env=env)
        dist = os.path.join(wt, 'app', 'dist')
        if not os.path.isfile(os.path.join(dist, 'index.html')):
            sys.exit('deploy: app build produced no dist/index.html')

        # ---------- assemble: repo tree; the BUILD IS THE SITE ----------
        # dist lands at the ROOT (its index.html REPLACES the retired static
        # landing page; assets/ merges with the repo's screenshot dir), and
        # app/ becomes a one-line redirect stub so old /app/ deep links
        # still land on the gallery. One live layout means the app's
        # root-exact routes (testdata/…, viewer/models…) never resolve
        # above the Pages prefix from a /app/ copy.
        app = os.path.join(wt, 'app')
        bdir = dist
        keep = os.path.join(tmp, 'dist')
        shutil.move(bdir, keep)
        shutil.rmtree(app)
        os.makedirs(app)
        with open(os.path.join(app, 'index.html'), 'w') as f:
            f.write('<!doctype html><meta charset="utf-8">'
                    '<meta http-equiv="refresh" content="0; url=../">'
                    '<title>Archean Blueprint Inspector</title>'
                    '<p>The inspector moved <a href="../">up one level</a>.'
                    '</p>\n')
        for name in os.listdir(keep):
            src, dst = os.path.join(keep, name), os.path.join(wt, name)
            if os.path.isdir(src):
                shutil.copytree(src, dst, dirs_exist_ok=True)
            else:
                shutil.copy2(src, dst)
        n_app = sum(len(f) for _, _, f in os.walk(keep))

        # Append-only ASSETS (2026-10-28 law): a redeploy that REPLACES
        # assets/ breaks every tab opened from the previous deploy — their
        # baked module graph names the OLD content-hashed chunks, the
        # missing file 404s as text/html and the MIME check kills the lazy
        # import (real report: XenonDialog-CAal9seJ.js blocked on a live
        # tab). Materialize the CURRENT pages tip's assets/ that this build
        # does not carry, so every tab ever served keeps lazy-loading.
        # Chunk names are content-hashed -> old and new coexist; index.html
        # references only THIS build's hashes.
        try:
            run('git', '-C', wt, 'fetch', 'origin', 'pages', capture=True)
            listing = run('git', '-C', wt, 'ls-tree', '-r', '--name-only',
                          'FETCH_HEAD', '--', 'assets/', capture=True)
            keep_old = [p for p in listing.splitlines()
                        if p.startswith('assets/')
                        and not os.path.exists(os.path.join(wt, p))]
            for i in range(0, len(keep_old), 200):
                run('git', '-C', wt, 'checkout', 'FETCH_HEAD', '--',
                    *keep_old[i:i + 200])
            print(f'deploy: kept {len(keep_old)} prior-deploy asset(s) '
                  f'(append-only assets)')
        except Exception as e:                                # first deploy
            print(f'deploy: asset keep skipped ({e}) — no pages tip yet?')

        # Plumbing, NOT `switch --orphan`: the build legitimately rewrites
        # app/index.html (bundle tags injected), so a checkout would fight
        # "local changes". add -A stages the ASSEMBLED tree, write-tree +
        # PARENTELESS commit-tree make the orphan snapshot directly.
        run('git', '-C', wt, 'add', '-A', '--', '.')
        tree = run('git', '-C', wt, 'write-tree', capture=True).strip()
        ver = run('git', 'describe', '--tags', '--abbrev=0', ref_sha,
                  capture=True).strip() or ref_sha[:8]
        commit = run('git', '-C', wt, 'commit-tree', tree, '-m',
                     f'Pages deploy {ver} (built from {ref_sha[:12]})\n\n'
                     f'Generated by tools/deploy_pages.py — repo tree at '
                     f'{ref_sha}; the vite build ships AT THE SITE ROOT '
                     f'(the app is the site) + /app/ alias '
                     f'({n_app} build files, corpus pinned to testdata). '
                     f'Never edit by hand.',
                     capture=True).strip()
        if args.dry_run:
            print(f'deploy: DRY RUN — snapshot {commit[:8]} (tree {tree[:8]}, '
                  f'app/ = {n_app} files); nothing pushed')
            return
        run('git', '-C', wt, 'push', '-f', 'origin',
            f'{commit}:refs/heads/pages')
        print('deploy: pushed pages — Pages rebuilds if its source branch '
              'is `pages` (AGENTS.md § Publishing).')
        print('deploy: https://joeppie.github.io/archean-blueprint-tools/app/')
    finally:
        subprocess.run(['git', 'worktree', 'remove', '--force', wt],
                       cwd=ROOT, stderr=subprocess.DEVNULL)
        subprocess.run(['git', 'worktree', 'prune'], cwd=ROOT,
                       stdout=subprocess.DEVNULL)
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    main()
