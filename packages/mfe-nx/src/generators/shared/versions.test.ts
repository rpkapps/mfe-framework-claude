import { NX_VERSION } from '@nx/devkit'
import { describe, expect, it } from 'vitest'

import { isAngularCompatibleTypeScript, nxAngularVersionFor } from './versions.ts'

describe('nxAngularVersionFor', () => {
  it.each(['20.8.4', '^21.5.0', '~22.7.12', '22.7.12'])(
    "pins @nx/angular to the workspace's own Nx specifier %s",
    version => {
      expect(nxAngularVersionFor(version)).toBe(version)
    },
  )

  it('uses the running Nx when the workspace manifest lists none', () => {
    expect(nxAngularVersionFor(undefined)).toBe(NX_VERSION)
  })

  it.each(['19.8.0', '23.2.0', '^24.0.0'])(
    'refuses Nx %s, whose @nx/angular cannot build Angular 19.2',
    version => {
      expect(() => nxAngularVersionFor(version)).toThrowError(
        `it needs Nx 20, 21, 22 (the lines whose @nx/angular builds Angular 19), and the workspace uses nx ${version}`,
      )
    },
  )
})

describe('isAngularCompatibleTypeScript', () => {
  it.each(['5.5.4', '5.8.3', '~5.8.2', '~5.6.0'])('accepts %s', specifier => {
    expect(isAngularCompatibleTypeScript(specifier)).toBe(true)
  })

  it.each(['~6.0.3', '5.9.2', '^5.8.0', '5.4.5', 'latest'])(
    'rejects %s, which can resolve outside >=5.5 <5.9',
    specifier => {
      expect(isAngularCompatibleTypeScript(specifier)).toBe(false)
    },
  )
})
