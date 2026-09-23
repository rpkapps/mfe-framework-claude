/**
 * Running each load inside the `aroundLoad` of the adapter that parsed its entry, so a hook one
 * adapter needs while its containers evaluate never runs for another adapter's containers.
 */

import type { MfeAdapter, RegistryEntry } from '@company/mfe-core'

import type { ContainerLoader } from './container-loader.ts'

/** Wrapped inside the shared loader, so a hook runs once per load rather than once per waiter. */
export function withAdapterLoadHooks<TModule>(
  loader: ContainerLoader<TModule>,
  adapters: readonly MfeAdapter[],
): ContainerLoader<TModule> {
  const byKind = new Map(adapters.map(adapter => [adapter.kind, adapter]))

  const around = <T>(entry: RegistryEntry, load: () => Promise<T>): Promise<T> => {
    const adapter = byKind.get(entry.adapter)
    return adapter?.aroundLoad === undefined ? load() : adapter.aroundLoad(load, entry)
  }
  const load: ContainerLoader<TModule>['load'] = (entry, options) =>
    around(entry, () => loader.load(entry, options))
  if (loader.preload === undefined) return { load }

  const preload = loader.preload.bind(loader)
  return { load, preload: (entry, options) => around(entry, () => preload(entry, options)) }
}
