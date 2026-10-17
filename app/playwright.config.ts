import { defineConfig, devices } from '@playwright/test';

// Headless chromium drives the SPA against the dev server; the corpus
// folder is served by the vite plugin (tools/vite-corpus.ts), so the suite
// follows ARCHEAN_BLUEPRINTS / blueprints.conf exactly like run_tests.sh.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:5175',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'pixel7', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    // Vite binds ::1 by default; the whole suite is pinned to IPv4 loopback
    command: 'npm run dev -- --host 127.0.0.1 --port 5175 --strictPort',
    url: 'http://127.0.0.1:5175',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
