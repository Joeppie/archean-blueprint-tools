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
