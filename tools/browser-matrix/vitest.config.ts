import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'browser-matrix',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
