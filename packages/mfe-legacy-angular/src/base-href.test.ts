import { describe, expect, it } from 'vitest'

import { isMfeError } from '@company/mfe-core'

import {
  defaultLegacyBaseHrefSeam,
  LEGACY_BASE_HREF_SEAMS,
  normalizeBaseHref,
  resolveLegacyBaseHref,
  type LegacyBaseHrefSeam,
} from './base-href.ts'

describe('the app-pinned base href seam', () => {
  it('resolves the base href the app provides to Angular', () => {
    const resolved = resolveLegacyBaseHref({ name: 'asset-tracker' })

    expect(resolved).toEqual({
      baseHref: '/asset-tracker/',
      source: 'app-pinned',
      navigationOwnership: 'shell',
    })
  })

  it('keeps the pinned value even when the shell offers a different one', () => {
    const resolved = resolveLegacyBaseHref({
      name: 'asset-tracker',
      suppliedBaseHref: '/somewhere-else/',
    })

    expect(resolved.baseHref).toBe('/asset-tracker/')
    expect(resolved.source).toBe('app-pinned')
  })
})

describe('the delegated base href seam', () => {
  it('uses the base href single-spa supplied', () => {
    const resolved = resolveLegacyBaseHref({
      name: 'rigstream',
      suppliedBaseHref: '/rigstream/v2/',
    })

    expect(resolved).toEqual({
      baseHref: '/rigstream/v2/',
      source: 'single-spa',
      navigationOwnership: 'shell',
    })
  })

  it('falls back to the app prefix when single-spa supplied nothing', () => {
    const resolved = resolveLegacyBaseHref({ name: 'rigstream' })

    expect(resolved).toEqual({
      baseHref: '/rigstream/',
      source: 'fallback',
      navigationOwnership: 'shell',
    })
  })

  it('treats an empty supplied base href as nothing supplied', () => {
    const resolved = resolveLegacyBaseHref({ name: 'rigstream', suppliedBaseHref: '   ' })

    expect(resolved.baseHref).toBe('/rigstream/')
    expect(resolved.source).toBe('fallback')
  })

  it('normalizes a supplied value that is missing its slashes', () => {
    const resolved = resolveLegacyBaseHref({ name: 'rigstream', suppliedBaseHref: 'rigstream/v2' })

    expect(resolved.baseHref).toBe('/rigstream/v2/')
  })

  it('keeps an absolute supplied base href intact', () => {
    const resolved = resolveLegacyBaseHref({
      name: 'rigstream',
      suppliedBaseHref: 'https://shell.example.test/rigstream',
    })

    expect(resolved.baseHref).toBe('https://shell.example.test/rigstream/')
  })
})

describe('legacy apps outside the documented seams', () => {
  it('delegates to the shell and falls back to the app name', () => {
    const resolved = resolveLegacyBaseHref({ name: 'solutions-health' })

    expect(resolved).toEqual({
      baseHref: '/solutions-health/',
      source: 'fallback',
      navigationOwnership: 'shell',
    })
  })

  it('describes that default as a delegated seam', () => {
    expect(defaultLegacyBaseHrefSeam('solutions-health')).toEqual({
      kind: 'delegated',
      fallback: '/solutions-health/',
    })
  })

  it('lets a shell supply its own seam table without editing the adapter', () => {
    const seams: Record<string, LegacyBaseHrefSeam> = {
      'asset-tracker': { kind: 'delegated', fallback: '/fleet/' },
    }

    const resolved = resolveLegacyBaseHref({ name: 'asset-tracker', seams })

    expect(resolved).toEqual({
      baseHref: '/fleet/',
      source: 'fallback',
      navigationOwnership: 'shell',
    })
  })

  it('publishes the documented seams as data the shell can read', () => {
    expect(LEGACY_BASE_HREF_SEAMS['asset-tracker']).toEqual({
      kind: 'app-pinned',
      baseHref: '/asset-tracker/',
    })
    expect(LEGACY_BASE_HREF_SEAMS['rigstream']).toEqual({
      kind: 'delegated',
      fallback: '/rigstream/',
    })
  })
})

describe('navigation ownership', () => {
  it('declares shell-owned navigation for every legacy app, whichever seam applies', () => {
    const names = ['asset-tracker', 'rigstream', 'solutions-health']

    const owners = names.map(
      name => resolveLegacyBaseHref({ name, suppliedBaseHref: '/anything/' }).navigationOwnership,
    )

    expect(owners).toEqual(['shell', 'shell', 'shell'])
  })
})

describe('resolveLegacyBaseHref validation', () => {
  it('refuses to guess a base href without an app name', () => {
    let thrown: unknown
    try {
      resolveLegacyBaseHref({ name: '  ' })
    } catch (error) {
      thrown = error
    }

    expect(isMfeError(thrown)).toBe(true)
    expect(thrown).toMatchObject({ code: 'app/invalid-base-path' })
  })
})

describe('normalizeBaseHref', () => {
  it('gives a bare segment both slashes, because Angular resolves routes against them', () => {
    expect(normalizeBaseHref('rigstream')).toBe('/rigstream/')
  })

  it('adds only the trailing slash when the leading one is there', () => {
    expect(normalizeBaseHref('/rigstream')).toBe('/rigstream/')
  })

  it('leaves an already normalized value alone', () => {
    expect(normalizeBaseHref('/rigstream/')).toBe('/rigstream/')
  })

  it('treats an empty value as the document root', () => {
    expect(normalizeBaseHref('')).toBe('/')
    expect(normalizeBaseHref('/')).toBe('/')
  })
})
