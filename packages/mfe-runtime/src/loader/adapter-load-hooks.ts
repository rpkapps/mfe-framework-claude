/**
 * Running each load inside the `aroundLoad` of the adapter that parsed its entry, so a hook one
 * adapter needs while its containers evaluate never runs for another adapter's containers.
 */

import type { MfeAdapter, RegistryEntry } from '@company/mfe-core'

import { raceWithAbort, type ContainerLoader } from './container-loader.ts'

/** Wrapped inside the shared loader, so a hook runs once per load rather than once per waiter. */
export function withAdapterLoadHooks<TModule>(
  loader: ContainerLoader<TModule>,
  adapters: readonly MfeAdapter[],
): ContainerLoader<TModule> {
  const byKind = new Map(adapters.map(adapter => [adapter.kind, adapter]))

  const around = <T>(
    entry: RegistryEntry,
    load: () => Promise<T>,
    signal: AbortSignal,
  ): Promise<T> => {
    const adapter = byKind.get(entry.adapter)
    return adapter?.aroundLoad === undefined ? load() : adapter.aroundLoad(load, entry, { signal })
  }
  const load: ContainerLoader<TModule>['load'] = (entry, options) =>
    // Reject the hook's inner wait on expiry even if a network runtime ignores cancellation,
    // so an adapter's finally can release page globals and other evaluation-only state.
    around(
      entry,
      () => raceWithAbort(loader.load(entry, options), options.signal, entry),
      options.signal,
    )
  if (loader.preload === undefined) return { load }

  const preload = loader.preload.bind(loader)
  return {
    load,
    preload: (entry, options) =>
      around(
        entry,
        () => raceWithAbort(preload(entry, options), options.signal, entry),
        options.signal,
      ),
  }
}
