/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    testTimeout: 30000,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    deps: {
      inline: ['framer-plugin']
    }
  },
})