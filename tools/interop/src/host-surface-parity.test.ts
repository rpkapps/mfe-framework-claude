/**
 * Each adapter's `/host` is `export * from '@company/mfe-runtime'` plus that adapter's own
 * provider, so a shell moves between frameworks without relearning the runtime: every runtime
 * binding, the very same value, and exactly one name more.
 *
 * The runtime each surface is compared with is the module its own `export *` names, resolved from
 * the adapter's package as that re-export is, because this package does not depend on the runtime
 * itself and an application may not import it.
 */

import { createRequire } from 'node:module'

import * as angularHost from '@company/mfe-angular/host'
import * as reactHost from '@company/mfe-react/host'
import { describe, expect, it } from 'vitest'

/** The runtime module `adapter`'s `/host` re-exports. */
async function runtimeReExportedBy(adapter: string): Promise<Readonly<Record<string, unknown>>> {
  const fromHere = createRequire(import.meta.url)
  const fromAdapter = createRequire(fromHere.resolve(`${adapter}/package.json`))
  return (await import(/* @vite-ignore */ fromAdapter.resolve('@company/mfe-runtime'))) as Readonly<
    Record<string, unknown>
  >
}

const surfaces: readonly (readonly [string, Readonly<Record<string, unknown>>, string])[] = [
  ['@company/mfe-react', reactHost, 'MfeProvider'],
  ['@company/mfe-angular', angularHost, 'provideMfeRuntime'],
]

describe.each(surfaces)('%s/host', (adapter, host, provider) => {
  it('is the runtime’s own surface, binding for binding, plus exactly its provider', async () => {
    const runtime = await runtimeReExportedBy(adapter)

    expect(Object.keys(runtime).length).toBeGreaterThan(0)
    expect(Object.keys(host).filter(name => !(name in runtime))).toEqual([provider])
    for (const [name, value] of Object.entries(runtime)) {
      expect(host[name], name).toBe(value)
    }
  })
})

describe('the two adapters’ /host surfaces', () => {
  it('re-export one runtime, so each carries the other’s bindings bound to the same values', async () => {
    expect(await runtimeReExportedBy('@company/mfe-react')).toBe(
      await runtimeReExportedBy('@company/mfe-angular'),
    )
  })
})
