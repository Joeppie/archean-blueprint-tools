import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import corpus from './tools/vite-corpus.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), corpus()],
  test: {
    // pure-logic engine layer runs on plain node — no DOM, no WebGL
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
