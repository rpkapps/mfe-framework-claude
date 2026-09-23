import { logger } from '@nx/devkit'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { angularRspackVersionFor } from './versions.ts'

describe('angularRspackVersionFor', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    [20, '20.9.0'],
    [21, '21.6.5'],
    [22, '22.7.12'],
  ])('maps Nx %i to the verified @nx/angular-rspack line %s', (nxMajor, expected) => {
    expect(angularRspackVersionFor(nxMajor)).toBe(expected)
  })

  it('falls back to the Nx 22 line and warns for an unverified major', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})

    expect(angularRspackVersionFor(23)).toBe('22.7.12')

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toContain('Nx 23')
  })
})
