/**
 * What makes a container a React one, for the neutral build: where its definitions and `env` come
 * from, what it shares, what the design system adds, and how its file routes mark capabilities.
 */

import type { ContainerProfile } from '@company/mfe-build'

import { extractCapabilities } from './discovery/capabilities.ts'
import { extractRoutes } from './discovery/routes.ts'
import {
  REACT_ADAPTER,
  REACT_ANCHOR,
  REACT_FRAMEWORK,
  REACT_SHARING_POLICY,
} from './federation/sharing.ts'
import {
  designSystemStylesheetImports,
  exposeWithStyleRoot,
  styleRootModule,
} from './generate/styles.ts'
import type { ReactOptions } from './options.ts'

export function reactProfile(options: ReactOptions): ContainerProfile {
  return {
    generator: '@company/mfe-rspack',
    // Written although a host reads an entry that names no framework as React, so no adapter
    // has to guess.
    framework: REACT_FRAMEWORK,
    frameworkAnchor: REACT_ANCHOR,
    definitions: {
      factoryModules: [REACT_ADAPTER],
      appOptions: 'router: makeRouter',
      iconExample: "import { BellIcon } from 'lucide-react' then icon: BellIcon",
    },
    envModules: ['@company/mfe-rspack', '@company/mfe-rspack/env'],
    adapterModule: REACT_ADAPTER,
    sharing: REACT_SHARING_POLICY,
    stylesheet: { sources: '**/*.{ts,tsx}', imports: designSystemStylesheetImports },
    exposeDefinition: exposeWithStyleRoot,
    generatedFiles: context => {
      const styleRoot = styleRootModule(context)
      return styleRoot === null ? [] : [styleRoot]
    },
    readCapabilities: context =>
      extractCapabilities({
        routesDirectory: options.routesDirectory,
        ...context.owner,
        sources: context.sources,
      }),
    readRoutes: context =>
      extractRoutes({ routesDirectory: options.routesDirectory, sources: context.sources }),
    containerRootOption: 'pluginMfe({ containerRoot })',
  }
}
