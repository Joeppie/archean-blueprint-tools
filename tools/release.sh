#!/usr/bin/env bash
# release.sh — cut a STABLE release onto the `release` branch (AGENTS.md § Publishing).
#
# The release scheme:
#   main     = development. Every commit passes the pre-commit gate
#              (selftest + regtest smoke pair). Pages does NOT serve main.
#   release  = STABLE. GitHub Pages serves this branch (source: release / root).
#              A release = an EXACT main commit that passed the COMPLETE suite
#              (tests/run_tests.sh), fast-forwarded onto release and stamped with
#              an annotated tag v0.NN. release is ff-only: hotfixes go through
#              main like everything else — never rebase or cherry-pick release.
#
# Usage:  tools/release.sh          (version is read from the release strings)
#         tools/release.sh v0.NN    (same, but asserts the strings say v0.NN)
#
# Refuses (exit 1, BEFORE running anything) when:
#   - the tree is dirty, or HEAD is not main, or main is not pushed to origin
#   - the context-anchored v0.NN strings disagree (security-scan --versions)
#   - the tag v0.NN already exists on a DIFFERENT commit (bump the strings)
#   - origin/release is not an ancestor of main (diverged — reconcile via main)
# Then it runs the full suite; a FAIL aborts the release (release untouched).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

say() { echo "release: $*"; }
die() { echo "release: REFUSED — $*" >&2; exit 1; }

# ---------- preflight (everything that could waste a suite run) ----------
BR=$(git symbolic-ref --short HEAD)
[ "$BR" = main ] || die "run on main (you are on $BR)"
[ -z "$(git status --porcelain)" ] || die "working tree is dirty — commit first"

# the release strings (viewer title, README ×2, landing ×2) must all agree
python3 tools/security-scan.py --versions
VER=$(grep -oPm1 '(?<=Archean Blueprint Viewer v0\.)\d+' viewer/index.html)
TAG="v0.${VER}"
[ -z "${1:-}" ] || [ "$1" = "$TAG" ] || die "argument $1 disagrees with the release string $TAG"

ss -ltn 2>/dev/null | grep -q ":8650 " && die "port 8650 busy — stop the dev server (pkill -f '[h]ttp.server 8650')"

git fetch --quiet origin "refs/heads/*:refs/remotes/origin/*"
# NOTE: never `fetch --tags` here — the 2026-10-10 filter-repo rewrite left
# some clones' LOCAL old v0.9/v0.91 tags clobbering against the remote ones
# (fetch rc=1, silent death). Tag truth comes from ls-remote below.
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] \
  || die "main is not pushed — git push origin main first"
# tag truth = the REMOTE (a local stale tag of the same name must not gate us)
REMOTE_TAG=$(git ls-remote origin "refs/tags/$TAG^{}" | cut -f1)
if [ -n "$REMOTE_TAG" ]; then
  [ "$REMOTE_TAG" = "$(git rev-parse HEAD)" ] \
    || die "tag $TAG already exists on $(git rev-parse --short "$REMOTE_TAG") on origin — bump the version strings"
fi
if git ls-remote --exit-code --heads origin release >/dev/null 2>&1; then
  git merge-base --is-ancestor origin/release HEAD \
    || die "origin/release is NOT an ancestor of main (diverged) — merge it back into main first; release is never rebased"
fi

# ---------- the gate: the COMPLETE suite ----------
say "running the complete suite (tests/run_tests.sh)…"
tests/run_tests.sh || die "suite FAILED — release aborted, $TAG not cut, release branch untouched"

# ---------- fast-forward release + annotated tag + push ----------
git branch -f release HEAD
if ! git rev-parse -q --verify "refs/tags/$TAG" >/dev/null && [ -z "$REMOTE_TAG" ]; then
  git tag -a "$TAG" HEAD -m "$TAG — stable release $(date -u +%F). Suite: full PASS (run_tests.sh)."
fi
git push origin release
[ -n "$REMOTE_TAG" ] || git push origin "refs/tags/$TAG"
say "$TAG = $(git rev-parse --short HEAD) now on release → Pages will rebuild."

# ---------- GitHub Release (best effort: gh installed + authed) ----------
GH=$(command -v gh || echo "$HOME/.local/bin/gh")
if [ -x "$GH" ] && "$GH" auth status >/dev/null 2>&1; then
  PREV=$(git describe --tags --abbrev=0 "HEAD^" 2>/dev/null || true)
  NOTES=$(git log --pretty='- %s' "${PREV:+$PREV..HEAD}")
  "$GH" release create "$TAG" --verify-tag --title "$TAG" --notes "$NOTES" 2>/dev/null \
    || say "GitHub Release not created (it may already exist)"
fi
say "done: https://joeppie.github.io/archean-blueprint-tools/viewer/index.html (after the Pages build)"
