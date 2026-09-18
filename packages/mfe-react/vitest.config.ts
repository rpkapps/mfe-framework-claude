import { defineConfig } from 'vitest/config'

/**
 * The repository's root config collects every package as one run. This is the
 * same project, so `pnpm --filter @company/mfe-react test` behaves identically
 * from inside the package — without it `vitest run` here falls back to the
 * node environment and every rendering test fails on `document is not defined`.
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./vitest.setup.ts'],
  },
})
