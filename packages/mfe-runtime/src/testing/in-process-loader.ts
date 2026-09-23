/**
 * Resolves definitions from a Map, under `/testing` so the federation-free path a contract
 * test needs can never be reached from a production entry point.
 */

import { createMfeError } from '@company/mfe-core'

import type { ContainerLoader, LoadedDefinition } from '../loader/container-loader.ts'

export function createInProcessLoader<TModule>(
  definitions: ReadonlyMap<string, LoadedDefinition<TModule>>,
): ContainerLoader<TModule> {
  return {
    // `async` is load-bearing: the ContainerLoader contract requires an aborted signal and
    // a missing definition to arrive as a rejected promise, not a synchronous throw.
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
