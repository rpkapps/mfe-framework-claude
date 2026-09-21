/**
 * What `#mfe/config` resolves to in a test. Pointing the alias here leaves the source under
 * test exactly as it ships — it still writes `import { config } from '#mfe/config'` — and the
 * test supplies the values (§14).
 */

import { createMfeError } from '@company/mfe-core'

let values: Readonly<Record<string, unknown>> | null = null

/** The values this container is configured with for the current test. */
export function setMfeConfig(next: Readonly<Record<string, unknown>>): void {
  values = Object.freeze({ ...next })
}

export function resetMfeConfig(): void {
  values = null
}

function read(field: string): unknown {
  if (values === null) {
    throw createMfeError({
      code: 'config/missing',
      id: 'the test environment',
      operation: `read the configuration field '${field}'`,
      expected: 'configuration installed by the test',
      observed: 'nothing installed',
      repair: `Call setMfeConfig({ ${field}: … }) before rendering. It is reset after every test, so one test cannot inherit another's configuration.`,
    })
  }

  if (!(field in values)) {
    throw createMfeError({
      code: 'config/invalid',
      id: 'the test environment',
      operation: `read the configuration field '${field}'`,
      expected: `'${field}' among the installed values`,
      observed:
        Object.keys(values).length === 0
          ? 'an empty configuration'
          : `only ${Object.keys(values).join(', ')}`,
      repair: `Add ${field} to the setMfeConfig call for this test. Reading an undeclared field silently would let a test pass against configuration the deployment never supplies.`,
    })
  }

  return values[field]
}

/** A proxy, so an unset field names itself instead of reading `undefined` elsewhere. */
export const config: Readonly<Record<string, unknown>> = new Proxy(Object.freeze({}), {
  get: (_target, field) => {
    // Symbols and `then` are how a runtime inspects a module namespace, never author reads.
    if (typeof field !== 'string' || field === 'then') return undefined
    return read(field)
  },
  has: (_target, field) => typeof field === 'string' && values !== null && field in values,
  ownKeys: () => (values === null ? [] : Object.keys(values)),
  getOwnPropertyDescriptor: (_target, field) =>
    typeof field === 'string' && values !== null && field in values
      ? { configurable: true, enumerable: true, value: values[field] }
      : undefined,
})

export default config
