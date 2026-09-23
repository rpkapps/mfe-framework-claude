/**
 * A made-up integration and adapter, so every test here also shows that the neutral build names
 * no real one: whatever reaches the output came from the profile.
 */

import { SINGLETON } from '../federation/sharing.ts'
import type { ContainerProfile } from '../profile.ts'

export const TEST_ADAPTER = '@acme/mfe-adapter'

export const TEST_PROFILE: ContainerProfile = {
  generator: '@acme/mfe-plugin',
  definitions: {
    factoryModules: [TEST_ADAPTER],
    appOptions: 'routes',
    iconExample: "import { BellIcon } from '@acme/icons' then icon: BellIcon",
  },
  envModules: ['@acme/mfe-plugin', '@acme/mfe-plugin/env'],
  adapterModule: TEST_ADAPTER,
  sharing: {
    [TEST_ADAPTER]: SINGLETON,
    '@acme/ui-kit/': { singleton: false, strictVersion: false },
  },
  stylesheet: { sources: '**/*.{ts,html}' },
  containerRootOption: 'acmeMfe({ containerRoot })',
}
