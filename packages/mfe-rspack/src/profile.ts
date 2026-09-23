/**
 * What makes a container a React one, for the neutral build: where its definitions and `env` come
 * from, what it shares, what the design system adds, and how its file routes mark capabilities.
 */

import type { ContainerProfile } from '@company/mfe-build'

import { extractCapabilities } from './discovery/capabilities.ts'
import { REACT_SHARING_POLICY } from './federation/sharing.ts'
import {
  designSystemStylesheetImports,
  exposeWithStyleRoot,
  styleRootModule,
} from './generate/styles.ts'
import type { ReactOptions } from './options.ts'

/** No `framework`: a React container's registry entry and manifest carry none, as always. */
export function reactProfile(options: ReactOptions): ContainerProfile {
  return {
    generator: '@company/mfe-rspack',
    definitions: {
      factoryModules: ['@company/mfe-react'],
      appOptions: 'router: makeRouter',
      iconExample: "import { BellIcon } from 'lucide-react' then icon: BellIcon",
    },
    envModules: ['@company/mfe-rspack', '@company/mfe-rspack/env'],
    adapterModule: '@company/mfe-react',
    sharing: REACT_SHARING_POLICY,
    stylesheet: { sources: '**/*.{ts,tsx}', imports: designSystemStylesheetImports },
    exposeDefinition: exposeWithStyleRoot,
    generatedFiles: context => {
      const styleRoot = styleRootModule(context)
      return styleRoot === null ? [] : [styleRoot]
    },
    readCapabilities: context =>
      extractCapabilities({ routesDirectory: options.routesDirectory, ...context.owner }),
    containerRootOption: 'pluginMfe({ containerRoot })',
  }
}
