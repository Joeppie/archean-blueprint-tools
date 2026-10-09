#!/usr/bin/env bash
# Install the repo's git hooks (mandatory checkin gate). Run once per clone.
set -e
cd "$(git rev-parse --show-toplevel)"
install -m 0755 tests/pre-commit .git/hooks/pre-commit
echo "installed .git/hooks/pre-commit (security scan + version sync — AGENTS.md)"
