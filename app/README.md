# `app/` — the React + TypeScript rewrite

The SPA that REPLACES the zero-build `viewer/` (see ../REWRITE.md for the
phase plan and porting status, ../AGENTS.md for the repo-wide rules).
This npm project is the ONLY toolchain in the repository — the legacy
`viewer/` stays plain ES modules + CDN Three.js with no build step, and the
release line does not move to `app/` until Phase 5 parity.

## Stack (decided — see REWRITE.md § Target stack)

| Concern | Choice |
|---|---|
| Bundler/dev server | **Vite 8** (Rolldown bundler) + `@vitejs/plugin-react` 6 (Oxc transform) |
| UI | React 19, TypeScript strict (`noUncheckedIndexedAccess`), Tailwind 4 + Radix/shadcn primitives |
| State | zustand slices + immer; one dirty-checked blueprint store, panels subscribe per-field |
| 3D | three.js from npm inside a HEADLESS scene engine (`src/engine/` never imports React; React only mounts `<Viewport>` and calls `attach`) |
| Unit tests | vitest — the pure engine layer runs on plain node (no DOM, no WebGL) |
| E2E | Playwright — chromium + pixel7 projects, `e2e/*.spec.ts` |
| Lint | Oxlint (`npm run lint`) — no ESLint |

## Commands

```bash
npm install                      # one-time, per checkout (NEVER symlink node_modules)
npm test                         # vitest — pure engine core (palette, format maths, …)
npm run test:e2e                 # Playwright chromium+pixel7 (boots its own dev server;
                                 #   E2E_PORT=<p> to dodge a stale server on 5175)
npm run dev -- --host 0.0.0.0    # dev server — bind ALL interfaces (AGENTS rule:
                                 #   never loopback-only; view remotely over Tailscale,
                                 #   `tailscale ip -4` → http://<that-ip>:5175/)
npm run serve                    # tsc -b && vite build && preview on 0.0.0.0:5175
npm run lint                     # oxlint
npx tsc -b                       # typecheck gate
```

## Blueprint corpus — no hardcoded paths

`tools/vite-corpus.ts` implements AGENTS § Blueprint folder for the app: the
corpus root resolves env `ARCHEAN_BLUEPRINTS` > repo-root `blueprints.conf` >
`<repo>/testdata` (mirrors `tools/config.py`). It serves `/corpus/` (listing,
`blueprint.json`, cached `preview.jpg`) on BOTH the dev and preview servers,
and compiles the gallery catalog STATICALLY into the bundle
(`virtual:gallery`) — so after moving the corpus, rebuild (`npm run serve`).

## Versioned craft cache — rev + SHA-256 + staleness warnings (v1.9.5)

The IndexedDB craft cache (`src/crafts.ts`, DB `archean-crafts` **v2**, store
data survives the upgrade) never serves an unverifiable copy silently:

- **Stamp.** Every catalog entry carries `{rev, sha, bytes, mtime}` of its
  `blueprint.json`: `rev = '<bytes>-<mtimeMs>'` (cheap version tag) and
  `sha` = hex SHA-256 of the bytes as served. The `/corpus/<id>/blueprint.json`
  route repeats both as `X-Blueprint-Rev` / `X-Blueprint-Sha` response
  headers; catalog, route and bytes resolve through the SAME
  corpus-first-fixture-floor helper, so a staleness flag can never describe
  a different file than a download would fetch.
- **Hashing strategy: EAGER** at catalog compile, memoised per
  `(path, size, mtimeMs)` — the full machine corpus (244 blueprints, 44 MiB)
  compiles in ~150 ms once; dev-watch recompiles re-hash only changed files.
  (Escape hatch if a corpus ever reaches many thousands of files: move the
  sha line in `galleryData()` to a deferred fill + module invalidation.)
- **States** (`craftState(id, meta)`; `meta` arrives from
  `gallery-catalog.craftMeta()` — `crafts.ts` imports no catalog module):
  `fresh` (rev matches the catalog and a captured sha still matches the
  stored text), `stale` (rev differs — file edited after caching),
  `unknown` (legacy v1 entry, unverified download, sha mismatch or corrupted
  record — always warned, never trusted silently), `absent` (not cached).
- **Download path** verifies the fetched bytes' SHA-256 (WebCrypto
  `crypto.subtle`, with a pure-JS SHA-256 fallback for plain-http non-secure
  contexts) against the served digest (or the catalog's, on the static Pages
  layout). A MISMATCH still opens for the session but is stored WITHOUT
  rev/sha → permanently `unknown`, with a `console.warn`.
- **UI.** Gallery cards show a status chip for cached crafts only:
  subtle ✓ `up-to-date`, amber ⚠ `edited since cached` (tooltip:
  `cached <date> · file changed <date> — will ask before opening`), ⚠ for
  unversioned copies (`card-status-<state>-<id>` testids). Opening a
  `stale`/`unknown` craft raises `StaleDialog`
  (`stale-open-dialog` / `stale-download` / `stale-usecached`): the user
  picks **[Download latest]** (force redownload, progress overlay) or
  **[Open cached copy]** (this cached text, this one time) — nothing is used
  or replaced silently. `fresh` opens with ZERO network requests (the
  standing rule), `absent` downloads as before, and File ▸ **Refresh craft
  (redownload)** stays the manual escape hatch.
- **Tests:** `src/__tests__/crafts.test.ts` (states, both sha paths,
  mismatch handling), `src/engine/__tests__/corpus-staleness.test.ts`
  (temp-corpus fixture through the REAL catalog compile: edit a file →
  rev/sha flip → `stale` → redownload → `fresh`; never touches a Steam
  folder), `e2e/staleness.spec.ts` (chip + dialog through the real UI).

## Layout

```
src/engine/       headless scene + pure format layer (doc/format/serialize,
                  palette, blockshapes, hull/hullfit/cull, pipes, subgrid,
                  sym, flight, scene.ts) — the vitest-covered core
src/              App/Editor UI, components/, zustand stores
e2e/              Playwright specs (panels, gizmo, symmetry, wiring, …)
tools/            vite-corpus.ts (corpus plugin)
```

Do not release from here unless the user explicitly asks (`tools/release.sh`
at repo root, AGENTS § Publishing).
