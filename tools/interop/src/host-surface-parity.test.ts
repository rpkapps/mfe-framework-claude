/**
 * The two adapters' `/host` surfaces have to carry the same bindings, so a shell moves between
 * frameworks without relearning the runtime. Each `/host` is `export * from '@company/mfe-runtime'`
 * plus that adapter's own provider, so the only name either should carry that the other does not
 * is its provider.
 */

import * as angularHost from '@company/mfe-angular/host'
import * as reactHost from '@company/mfe-react/host'
import { describe, expect, it } from 'vitest'

describe('the two adapters’ /host surfaces', () => {
  it('are equal apart from the framework provider', () => {
    const reactOnly = Object.keys(reactHost).filter(name => !(name in angularHost))
    const angularOnly = Object.keys(angularHost).filter(name => !(name in reactHost))

    expect(reactOnly).toEqual(['MfeProvider'])
    expect(angularOnly).toEqual(['provideMfeRuntime'])
  })

  it('bind every shared name to the same value', () => {
    const shared = Object.keys(reactHost).filter(name => name in angularHost)

    expect(shared.length).toBeGreaterThan(0)
    for (const name of shared) {
      expect(angularHost[name as keyof typeof angularHost], name).toBe(
        reactHost[name as keyof typeof reactHost],
      )
    }
  })
})
