/**
 * A made-up integration and adapter, so every test here also shows that the neutral build names
 * no real one: whatever reaches the output came from the profile.
 */

import { PAGE_SINGLETON, SINGLETON } from '../federation/sharing.ts'
import type { ContainerProfile } from '../profile.ts'

export const TEST_ADAPTER = '@acme/mfe-adapter'

/** The made-up framework's own package, whose installed version names its share scope. */
export const TEST_FRAMEWORK_ANCHOR = '@acme/ui-runtime'

export const TEST_PROFILE: ContainerProfile = {
  generator: '@acme/mfe-plugin',
  definitions: {
    factoryModules: [TEST_ADAPTER],
    appOptions: 'routes',
    iconExample: "import { BellIcon } from '@acme/icons' then icon: BellIcon",
  },
  envModules: ['@acme/mfe-plugin', '@acme/mfe-plugin/env'],
  adapterModule: TEST_ADAPTER,
  framework: 'acme',
  frameworkAnchor: TEST_FRAMEWORK_ANCHOR,
  sharing: {
    [TEST_ADAPTER]: SINGLETON,
    '@acme/ui-kit/': { singleton: false, strictVersion: false, frameworkScoped: true },
    '@acme/mfe-kernel': PAGE_SINGLETON,
  },
  stylesheet: { sources: '**/*.{ts,html}' },
  containerRootOption: 'acmeMfe({ containerRoot })',
}
