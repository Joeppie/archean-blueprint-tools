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
  use: {
    baseURL: URL,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'pixel7', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    // 0.0.0.0: IPv4 loopback stays exact (AGENTS dev-server binding rule)
    // and the run is also browsable over Tailscale while it lasts
    command: `npm run dev -- --host 0.0.0.0 --port ${PORT} --strictPort`,
    url: URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
