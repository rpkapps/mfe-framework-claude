/**
 * What makes a container an Angular one, for the neutral build: where its definitions, route data
 * and `env` come from, what it shares, and how its global CSS loads.
 */

import type { ContainerProfile } from '@company/mfe-build'

import { ANGULAR_ADAPTER } from './adapter.ts'
import { readRouteDataCapabilities } from './discovery/capabilities.ts'
import { readAngularRoutes } from './discovery/routes.ts'
import { ANGULAR_ANCHOR, ANGULAR_FRAMEWORK, ANGULAR_SHARING_POLICY } from './federation/sharing.ts'
import { GLOBAL_STYLE_QUERY, globalStylesheetImports } from './generate/styles.ts'
import { CONTAINER_ROOT_OPTION } from './options.ts'

/** The browser-safe subpath a container's `src/mfe.config.ts` imports `env` from. */
export const ENV_MODULE = '@company/mfe-nx/env'

/**
 * No `exposeDefinition`: an exposed entry re-exports the author's definition unchanged, because an
 * Angular mount needs no style root of the container's own around it.
 */
export function angularProfile(): ContainerProfile {
  return {
    generator: '@company/mfe-nx',
    framework: ANGULAR_FRAMEWORK,
    frameworkAnchor: ANGULAR_ANCHOR,
    definitions: {
      factoryModules: [ANGULAR_ADAPTER],
      appOptions: 'routes',
      iconExample: "import { Bell } from 'lucide-angular' then icon: Bell",
    },
    envModules: [ENV_MODULE],
    adapterModule: ANGULAR_ADAPTER,
    sharing: ANGULAR_SHARING_POLICY,
    // Angular containers write plain CSS. Angular inlines component styles and encapsulates them
    // itself, so they never reach this stylesheet.
    stylesheet: {
      tailwind: false,
      imports: globalStylesheetImports,
      query: GLOBAL_STYLE_QUERY,
    },
    readCapabilities: readRouteDataCapabilities,
    readRoutes: readAngularRoutes,
    containerRootOption: CONTAINER_ROOT_OPTION,
  }
}
