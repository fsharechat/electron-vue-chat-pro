import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    environmentMatchGlobs: [
      ['tests/main/**', 'node'],
      ['tests/renderer/**', 'jsdom'],
    ],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
      '@main': resolve(__dirname, 'src/main'),
    }
  }
})
