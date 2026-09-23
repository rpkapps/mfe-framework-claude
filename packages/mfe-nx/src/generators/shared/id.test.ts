import { describe, expect, it } from 'vitest'

import { assertUsableId } from './id.ts'

describe('assertUsableId', () => {
  it('accepts lower-case letters, digits and single hyphens', () => {
    expect(() => assertUsableId('alert-panel')).not.toThrow()
    expect(() => assertUsableId('widget2')).not.toThrow()
  })

  it('rejects an id that cannot serve as a storage prefix and a scope value', () => {
    expect(() => assertUsableId('Alert Panel')).toThrowError(
      /not a usable definition id.*storage prefix.*CSS scope value/s,
    )
  })

  it('rejects a leading or trailing hyphen', () => {
    expect(() => assertUsableId('-alert')).toThrowError(/not a usable definition id/)
    expect(() => assertUsableId('alert-')).toThrowError(/not a usable definition id/)
  })
})
