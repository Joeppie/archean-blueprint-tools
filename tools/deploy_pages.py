#!/usr/bin/env python3
"""deploy_pages.py — publish the PUBLIC site (GitHub Pages) from a release.

The site is the GENERATED `pages` branch: an orphan snapshot of the release
tree whose `app/` directory is REPLACED by the built SPA (app/dist), so the
public URL tree is

    /                              landing (index.html, links both apps)
    /viewer/index.html             legacy zero-build inspector (kept live)
    /testdata/<id>/blueprint.json  corpus the viewers fetch
    /viewer/models/<Type>.json     game model atlas (app BASES fallback)
    /app/                          the React Inspector (vite base './')

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

        # ---------- assemble: repo tree, app/ := the build ----------
        app = os.path.join(wt, 'app')
        bdir = dist
        keep = os.path.join(tmp, 'dist')
        shutil.move(bdir, keep)
        shutil.rmtree(app)
        shutil.move(keep, app)
        n_app = sum(len(f) for _, _, f in os.walk(app))

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
                     f'{ref_sha} with app/ replaced by the vite build '
                     f'({n_app} files, corpus pinned to testdata). '
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
