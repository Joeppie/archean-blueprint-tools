#!/usr/bin/env bash
# release.sh — cut a STABLE release onto the `release` branch (AGENTS.md § Publishing).
#
# RUN THIS ONLY WHEN THE USER EXPLICITLY ASKS TO RELEASE (2026-10-17 rule):
# a finished feature, a green suite, or a push to main do NOT imply one.
#
# The release scheme:
#   main     = development. Every commit passes the pre-commit gate
#              (selftest + regtest smoke pair). Pages does NOT serve main.
#   release  = STABLE. GitHub Pages serves the GENERATED `pages` branch
#              (tools/deploy_pages.py builds it from release + app/dist).
#              A release = an EXACT main commit that passed the COMPLETE suite
#              (tests/run_tests.sh), fast-forwarded onto release and stamped with
#              an annotated tag vX.Y.Z. THE SCHEME IS SEMVER (user rule
#              2026-10-20, after v1.2/v1.3 were burned on two fixes):
#                X major  UI overhaul, framework/rewrite step, scope change
#                         (v1.0 = the React app replacing the viewer + Pages
#                         root inversion)
#                Y minor  new features/capabilities (subgrid hinge UI, a new
#                         editor mode, a new analysis)
#                Z patch  fixes and small tweaks — the joint-line fix and the
#                         static-info setting were Z-sized work
#              Every NEW cut must be 3-part; the legacy 2-part tags (v1.0 …
#              v1.3) stay as they are and are read as X.Y.0. A fix therefore
#              goes v1.3 → v1.3.1 and NEVER onto Y. release is ff-only: hotfixes go
#              through main like everything else — never rebase or
#              cherry-pick release.
#   pages    = GENERATED public site (since the v1.0 app deploy): a
#              force-pushed snapshot of release + the built app/, published
#              by tools/deploy_pages.py. Never edited by hand.
#
# Usage:  tools/release.sh          (version is read from the release strings)
#         tools/release.sh vX.Y.Z   (same, but asserts the strings say vX.Y.Z)
#
# Refuses (exit 1, BEFORE running anything) when:
#   - the tree is dirty, or HEAD is not main, or main is not pushed to origin
#   - the context-anchored version strings disagree (security-scan --versions)
#   - the release string is not 3-part vX.Y.Z (semver: fixes bump Z, features
#     bump Y, only an overhaul bumps X)
#   - the version does not move FORWARD past the newest tag on origin
#   - the tag already exists on a DIFFERENT commit (bump the strings)
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

# the release strings (viewer title, README ×2, landing ×2, app title) must all agree
python3 tools/security-scan.py --versions
VER=$(grep -oPm1 '(?<=Archean Blueprint Viewer v)\d+\.\d+(?:\.\d+)?' viewer/index.html)
TAG="v${VER}"
[ -z "${1:-}" ] || [ "$1" = "$TAG" ] || die "argument $1 disagrees with the release string $TAG"
[[ "$VER" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
  || die "release string v$VER is not semver vX.Y.Z — fixes bump Z, features bump Y, overhauls bump X"

# the number must move FORWARD (a silent v1.3.0 after v1.3.2 would re-issue a
# tag that means something else). Tag TRUTH = the remote (never local tags —
# see the fetch --tags note below) and the ^{} peeled rows are collapsed.
LATEST=$(git ls-remote --tags origin 'refs/tags/v[0-9]*' \
  | sed 's|.*refs/tags/||; s|\^{}||' | sort -Vu | tail -1)
if [ -n "$LATEST" ]; then
  LV=${LATEST#v}
  # strictly BACKWARD is refused; EQUAL is allowed (re-cutting the same tag on
  # the same commit is the "suite re-run" path the tag check below handles).
  # sort -V puts the SMALLER first: the bump is backward iff that smaller one
  # is the NEW version (and the two are not simply equal).
  SMALL=$(printf '%s\n%s\n' "$LV" "$VER" | sort -V | head -1)
  { [ "$SMALL" != "$VER" ] || [ "$VER" = "$LV" ]; } \
    || die "v$VER goes BACKWARD — the newest tag on origin is $LATEST"
  # what kind of bump is this? (printed so a fix-onto-Y misfire is visible at
  # the moment of the cut). NOTE herestrings (<<<), NOT < <(printf) without a
  # trailing newline: read returns 1 at EOF and set -e would kill the preflight.
  local_split() { IFS=. read -r "$1" "$2" "$3" <<<"$4"; }
  local_split A B C "${LV}.0"          # 2-part legacy tags read as X.Y.0
  local_split X Y Z "$VER"
  KIND="major"
  [ "${X:-}" = "${A:-}" ] && KIND="minor"
  [ "${X:-}" = "${A:-}" ] && [ "${Y:-}" = "${B:-}" ] && KIND="patch"
  say "semver bump: $LATEST → $TAG  ($KIND — Z fixes · Y features · X overhaul)"
fi

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
