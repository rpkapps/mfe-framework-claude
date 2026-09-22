import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // The generated modules, as a test sees them. The real #mfe/config
      // fetches runtime-config.json in a top-level await and the real
      // #mfe/fetch builds a transport from the shell's session, so neither
      // works in a component test. Your source keeps its production imports
      // and the test supplies the values:
      //
      //   import { setMfeConfig, setMfeApiBaseUrl, setMfeFetch } from '@company/mfe-react/testing'
      //
      // tsconfig still maps these to the real generated modules, so a field
      // you never declared is still a type error.
      '#mfe/config': '@company/mfe-react/testing/mfe-config',
      '#mfe/fetch': '@company/mfe-react/testing/mfe-fetch',
      // Plain generated data with no side effects, so a test reads the real one.
      '#mfe/meta': fileURLToPath(new URL('./.mfe/meta.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
  },
})
