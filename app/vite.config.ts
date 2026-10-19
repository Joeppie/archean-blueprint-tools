import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import corpus from './tools/vite-corpus.ts'

// https://vite.dev/config/
export default defineConfig({
  // './' = RELATIVE asset URLs: the Pages deploy lives under
  // /archean-blueprint-tools/app/ (the repo URL path is NOT hardcoded —
  // AGENTS § Blueprint folder spirit); the dev/preview servers serve the app
  // at '/' and resolve the same './assets/…' + '../testdata/…' routes.
  base: './',
  plugins: [react(), tailwindcss(), corpus()],
  test: {
    // pure-logic engine layer runs on plain node — no DOM, no WebGL
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
