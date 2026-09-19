/**
 * A loader that resolves definitions from a Map: no bundler, manifest or
 * network. It lives under `/testing` so the federation-free path a contract
 * test needs can never be reached from a production entry point.
 */

import { createMfeError } from '@company/mfe-core'

import type { ContainerLoader, LoadedDefinition } from '../loader/container-loader.ts'

export function createInProcessLoader<TModule>(
  definitions: ReadonlyMap<string, LoadedDefinition<TModule>>,
): ContainerLoader<TModule> {
  return {
    // `async` is load-bearing here rather than incidental. The ContainerLoader
    // contract requires an already-aborted signal and a missing definition to
    // arrive as a rejected promise, and this implementation resolves from a Map
    // with nothing to await; without `async` both become a synchronous throw at
    // the call site, which no caller of a Promise-returning port handles.
    // eslint-disable-next-line @typescript-eslint/require-await -- the async signature is the port's contract and there is genuinely nothing to await
    load: async (entry, options) => {
      options.signal.throwIfAborted()

      const loaded = definitions.get(entry.id)
      if (!loaded) {
        throw createMfeError({
          code: 'load/entry-failure',
          id: entry.id,
          operation: 'resolve definition from the in-process loader',
          expected: `a definition registered under "${entry.id}"`,
          observed:
            definitions.size === 0
              ? 'an empty loader'
              : `only ${[...definitions.keys()].join(', ')}`,
          repair: 'Register the definition with the test environment before mounting it.',
        })
      }

      return loaded
    },
  }
}
