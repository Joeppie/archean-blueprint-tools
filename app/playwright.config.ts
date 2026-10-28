import { defineConfig, devices } from '@playwright/test';

// Headless chromium drives the SPA against the dev server; the corpus
// folder is served by the vite plugin (tools/vite-corpus.ts), so the suite
// follows ARCHEAN_BLUEPRINTS / blueprints.conf exactly like run_tests.sh.
// E2E_PORT keeps the suite off a port another (older) dev server may already
// hold — reuseExistingServer would then SILENTLY test that tree instead.
const PORT = Number(process.env.E2E_PORT ?? 5175);
const URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  // this box also serves the user's dev servers + AI models: the suite is
  // ENGINE-heavy (every test boots a three.js scene), and the lazy Editor
  // chunk makes cold opens burst-load. 6 parallel workers starved rAF and
  // the 5 s default assertion (flake-fest) — that was the SWIFTSHADER era.
  // v1.12.1: boots run the production bundle on iGPU GL (ANGLE-vulkan) —
  // measured 3→4 workers cuts the wall ~15 %, 5 is a plateau (32 cores),
  // no added flakes on the same slice.
  workers: 4,
  use: {
    baseURL: URL,
    trace: 'retain-on-failure',
    // the suites assert through the debug channel (SCENE PASS title +
    // scene-stats strip are DEBUG-ONLY in the shipped UI — user rule
    // 2026-10-19), so every context boots with the debug flag set
    storageState: {
      cookies: [],
      origins: [{
        origin: URL,
        localStorage: [
          { name: 'archean-app-debug', value: '1' },
          // v1.12.2 BOOT COST — BACKDROP-SKIP FIXTURE LAW (we: "Make a
          // backdrop Skip part of test fixture"): every boot loads the
          // default panorama (~86–350 kB + decode + upload) that NO spec
          // outside viewmenu asserts. The fixture ships ⊘ (none); the ONE
          // fresh-profile DEF pin re-arms the default by removing the key
          // in its own context (viewmenu.spec.ts). A spec that gains a
          // panorama law clicks the row explicitly — as the swap pins
          // already do.
          { name: 'archean-app-backdrop', value: 'none' },
          // v1.13.x: every context starts with a CLEAN world — the
          // worldsim store is GLOBAL+persisted; tests author it (base/override/
          // setworldsim), so the fixture ships it empty per context.
          { name: 'archean-worldsim', value: '' },],
      }],
    },
    // v1.12.1 BOOT COST: render on the AMD iGPU via ANGLE-Vulkan — the
    // same pin tests/run_tests.sh uses (VK_ICD_FILENAMES hides the NVIDIA
    // ICD ENTIRELY, so the discrete GPU serving the AI models is never
    // contended). Headless default = SwiftShader software GL: the scene's
    // first frames cost hundreds of ms more per boot.
    launchOptions: {
      args: ['--use-gl=angle', '--use-angle=vulkan'],
      env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
    },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'pixel7',
      use: { ...devices['Pixel 7'] },
      // L4 (docs/TEST-PYRAMID.md): the device matrix is OPT-IN. These specs
      // contain ZERO device-conditional asserts — their pixel7 leg re-runs
      // identical desktop laws at a smaller canvas, which is not coverage,
      // it is a canvas-resize flake generator. A spec that GAINS a phone
      // law removes its name from this list (or tags the phone test).
      testIgnore:
        /(app|asset-space|blockedit|blockplace|download|gizmo|hinge|isolation|liveedit|paint|pipes|propeller|savefidelity|staleness|subride|sym|views|wheels|xenon|xenondbg|xenonfresh)\.spec\.ts$/,
    },
  ],
  webServer: {
    // 0.0.0.0: IPv4 loopback stays exact (AGENTS dev-server binding rule)
    // and the run is also browsable over Tailscale while it lasts.
    // v1.12.1 BOOT COST: the suite drives the PRODUCTION build through
    // `vite preview` — a handful of hashed chunks per boot instead of the
    // dev server's 300-module transform waterfall. The corpus plugin's
    // shared handler serves /corpus, /models, /atlas, /viewer and /testdata
    // on preview too (the Pages layout recipe), so every route behaves as
    // in dev. Build cost is paid ONCE per run; e2e also exercises the
    // SHIPPED bundle. E2E_DEV=1 falls back to the dev server (fast
    // iteration on a single spec while editing source).
    // v1.12.6 BUILD-COST MEASURED (we: "40 s for a build is very long —
    // does it include unit tests? lint?"): No — and the build is not 40 s.
    // `tsc -b` + rolldown measured 7 s; the ceremony around it (npm spawns,
    // preview boot, readiness) is 23 s of the 91 s fast tier. The webServer
    // therefore builds with `vite build` DIRECTLY: the typecheck is a
    // mandatory gate per landing in the gate ladder (npm test + tsc -b +
    // targeted playwright), so the suite loses no guarantee, and every
    // targeted single-spec run stops paying the typechecker.
    command: process.env.E2E_DEV
      ? `npm run dev -- --host 0.0.0.0 --port ${PORT} --strictPort`
      : `npx vite build && npm run preview -- --host 0.0.0.0 --port ${PORT} --strictPort`,
    url: URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
