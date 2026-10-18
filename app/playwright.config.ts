import { defineConfig, devices } from '@playwright/test';

// Headless chromium drives the SPA against the dev server; the corpus
// folder is served by the vite plugin (tools/vite-corpus.ts), so the suite
// follows ARCHEAN_BLUEPRINTS / blueprints.conf exactly like run_tests.sh.
const PORT = process.env.E2E_PORT ?? '5175';   // run parallel trees via E2E_PORT

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  // this box also serves the user's dev servers + AI models: the suite is
  // ENGINE-heavy (every test boots a three.js scene), and the lazy Editor
  // chunk makes cold opens burst-load. 6 parallel workers starved rAF and
  // the 5 s default assertion (flake-fest); 3 keeps the run honest.
  workers: 3,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'pixel7', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    // Vite binds ::1 by default; the whole suite is pinned to IPv4 loopback
    command: `npm run dev -- --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
