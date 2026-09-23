/**
 * The React adapter's federation loader, which is the neutral one from the runtime. What a React
 * container needs hidden while it evaluates is `reactAdapter.aroundLoad`, which the runtime
 * applies around every load of a React entry, so it is not applied here a second time.
 */

import type { BrandedDefinition, RegistryEntry } from '@company/mfe-core'
import {
  createFederationContainerLoader,
  isFederatedEntry,
  type ContainerLoader,
  type FederationRuntime,
} from '@company/mfe-runtime'

export interface Mf2LoaderOptions {
  /** Injected so this module has no import-time side effects and tests need no real runtime. */
  readonly runtime: FederationRuntime
}

/** Any adapter's federated entry names its container, so a caller asks here rather than casting. */
export function containerNameOf(entry: RegistryEntry): string | undefined {
  return isFederatedEntry(entry) ? entry.container : undefined
}

/** Loads every adapter's containers, so a React shell can also host an Angular one. */
export function createMf2ContainerLoader(
  options: Mf2LoaderOptions,
): ContainerLoader<BrandedDefinition> {
  return createFederationContainerLoader({ runtime: options.runtime })
}
