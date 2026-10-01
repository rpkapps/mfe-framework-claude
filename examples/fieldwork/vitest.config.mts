import { fileURLToPath } from 'node:url'

import angular from '@analogjs/vite-plugin-angular'
import { defineConfig } from 'vitest/config'
import { sharedStateDeclarationsForTests } from '../../tools/shared-state/vitest.mjs'

/**
 * JIT, not AOT: Vitest never runs the webpack build, so the compiler transform has to run
 * in-process for signal `input()`/`output()` — and everything else Angular's decorators declare —
 * to work under Vitest at all.
 */
export default defineConfig({
  plugins: [
    angular({ jit: true, tsconfig: './tsconfig.spec.json' }),
    sharedStateDeclarationsForTests,
  ],
  resolve: {
    alias: {
      // The real #mfe/config fetches runtime-config.json in a top-level await, and the real
      // #mfe/fetch builds a transport from the shell's session, so neither works in a component
      // test. Your source keeps its production imports; the test supplies the values with
      // @company/mfe-angular/testing's setMfeConfig/setMfeFetch. tsconfig still maps these to the
      // real generated modules, so a field you never declared is still a type error.
      '#mfe/config': '@company/mfe-angular/testing/mfe-config',
      '#mfe/fetch': '@company/mfe-angular/testing/mfe-fetch',
      // Plain generated data with no side effects, so a test reads the real one.
      '#mfe/meta': fileURLToPath(new URL('./.mfe/meta.ts', import.meta.url)),
      '#mfe/shared-state/fieldwork': fileURLToPath(
        new URL('./.mfe/shared-state/fieldwork.ts', import.meta.url),
      ),
      '#mfe/shared-state/well-inspection': fileURLToPath(
        new URL('./.mfe/shared-state/well-inspection.ts', import.meta.url),
      ),
    },
  },
  test: {
    // The adapter carries JSON records; VM pools clone objects into a different realm.
    pool: 'forks',
    environment: 'jsdom',
    include: ['src/**/*.spec.ts'],
    setupFiles: ['./vitest.setup.ts'],
  },
})
