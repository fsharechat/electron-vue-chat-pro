import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  test: {
    globals: true,
    environmentMatchGlobs: [
      ['src/main/**', 'node'],
      ['src/renderer/**', 'jsdom'],
    ],
  },
  resolve: {
    alias: { '@': resolve(__dirname, 'src/renderer/src') }
  }
})
