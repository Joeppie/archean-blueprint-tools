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
  build: {
    // v1.12.2 BOOT COST — chunk diet. THREE (three.js + its addons) is a
    // stable vendor: on Pages it becomes its OWN hashed chunk that survives
    // every app release in the browser cache (the 428 kB gz Editor chunk
    // used to re-download for one app-code byte). The app-code Editor
    // chunk shrinks to the app. e2e is unaffected (fresh contexts download
    // both chunks from the local preview server in one round trip).
    rollupOptions: {
      output: {
        advancedChunks: {
          groups: [
            { name: 'three', test: /node_modules[\\/]three[\\/]/, priority: 20 },
            { name: 'vendor', test: /node_modules[\\/](react|react-dom|scheduler|use-sync-external-store|use-context-selector|@radix-ui)[\\/]/, priority: 10 },
          ],
        },
      },
    },
  },
  test: {
    // pure-logic engine layer runs on plain node — no DOM, no WebGL
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
  },
})
