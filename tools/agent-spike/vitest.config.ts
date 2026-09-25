import { defineConfig } from 'vitest/config'

import { sourceSsrForTests } from '../workspace/conditions.mjs'

/**
 * Not a project of the repository's root config: the spike runs when asked (`pnpm --filter
 * @company/agent-spike spike`), so a throwaway experiment never holds up the suite. The Agent
 * Framework backend is tested too when `AGENT_SPIKE_DOTNET_URL` names one that is running.
 */
export default defineConfig({
  ssr: sourceSsrForTests,
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
