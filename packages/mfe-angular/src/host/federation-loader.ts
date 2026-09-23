/**
 * The Module Federation loader for an Angular host. The neutral loader does all of it; unlike the
 * React adapter's, no load needs wrapping, because nothing an Angular container evaluates reads a
 * global the host has set.
 */

import type { BrandedDefinition } from '@company/mfe-core'
import {
  createFederationContainerLoader,
  type ContainerLoader,
  type FederationRuntime,
} from '@company/mfe-runtime'

export interface Mf2LoaderOptions {
  /** Injected so this module has no import-time side effects and tests need no real runtime. */
  readonly runtime: FederationRuntime
}

export function createMf2ContainerLoader(
  options: Mf2LoaderOptions,
): ContainerLoader<BrandedDefinition> {
  return createFederationContainerLoader({ runtime: options.runtime })
}
