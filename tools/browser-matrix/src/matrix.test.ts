import { describe, expect, it } from 'vitest'

import { computeMatrix, isFullySupported } from './matrix.ts'
import { createFakeSupportData, type FakeDataSpec } from './testing.ts'

/**
 * Two browsers, two required features. `scope` is the late feature that sets
 * the floor; `abort` is older. Usage is arranged so the numbers in the coverage
 * assertions are exact.
 */
const spec: FakeDataSpec = {
  browsers: {
    chrome: {
      released: ['100', '101', '102'],
      usage: { '100': 5, '101': 20, '102': 60 },
    },
    oldie: {
      released: ['8', '9'],
      usage: { '8': 1, '9': 4 },
    },
  },
  features: {
    scope: {
      chrome: { '100': 'n', '101': 'y', '102': 'y' },
      oldie: { '8': 'n', '9': 'n' },
    },
    abort: {
      chrome: { '100': 'y', '101': 'y', '102': 'y' },
      oldie: { '8': 'y', '9': 'y' },
    },
  },
}

const data = createFakeSupportData(spec)

describe('isFullySupported', () => {
  it('accepts a plain `y`', () => {
    expect(isFullySupported('y')).toBe(true)
    expect(isFullySupported('y #1')).toBe(true)
  })

  it('rejects partial, flagged, prefixed, missing and unsupported cells', () => {
    expect(isFullySupported('a')).toBe(false)
    expect(isFullySupported('a #2')).toBe(false)
    expect(isFullySupported('n')).toBe(false)
    expect(isFullySupported('n d #1')).toBe(false)
    expect(isFullySupported('y x')).toBe(false)
    expect(isFullySupported(undefined)).toBe(false)
  })
})

describe('computeMatrix feature intersection', () => {
  it('excludes a browser version that is missing one of the required features', () => {
    const matrix = computeMatrix(data, { featureIds: ['scope', 'abort'] })
    const chrome = matrix.floors.find(floor => floor.browser === 'chrome')

    // chrome 100 has `abort` but not `scope`, so the floor is 101.
    expect(chrome?.version).toBe('101')
    expect(chrome?.versions).toEqual(['101', '102'])
    expect(matrix.supportedVersions).toEqual(['chrome 101', 'chrome 102'])
  })

  it('keeps the older floor when the late feature is not required', () => {
    const matrix = computeMatrix(data, { featureIds: ['abort'] })
    expect(matrix.floors.find(floor => floor.browser === 'chrome')?.version).toBe('100')
    expect(matrix.floors.find(floor => floor.browser === 'oldie')?.version).toBe('8')
  })

  it('excludes a browser with no version supporting every feature, and says which', () => {
    const matrix = computeMatrix(data, { featureIds: ['scope', 'abort'] })
    const excluded = matrix.excluded.find(entry => entry.browser === 'oldie')

    expect(matrix.floors.map(floor => floor.browser)).not.toContain('oldie')
    expect(excluded?.latestReleased).toBe('9')
    expect(excluded?.missingFeatures).toEqual([{ id: 'scope', support: 'n' }])
    expect(excluded?.usage).toBe(5)
  })

  it('treats partial support (`a`) as unsupported', () => {
    const partial = createFakeSupportData({
      ...spec,
      features: {
        ...spec.features,
        scope: {
          chrome: { '100': 'n', '101': 'a #1', '102': 'y' },
          oldie: { '8': 'n', '9': 'a' },
        },
      },
    })
    const matrix = computeMatrix(partial, { featureIds: ['scope', 'abort'] })

    expect(matrix.floors.find(floor => floor.browser === 'chrome')?.version).toBe('102')
    expect(matrix.excluded.find(entry => entry.browser === 'oldie')?.missingFeatures).toEqual([
      { id: 'scope', support: 'a' },
    ])
  })

  it('requires support to be contiguous from the newest release, so a regression raises the floor', () => {
    const regressed = createFakeSupportData({
      ...spec,
      features: {
        ...spec.features,
        scope: {
          chrome: { '100': 'y', '101': 'n', '102': 'y' },
          oldie: { '8': 'n', '9': 'n' },
        },
      },
    })
    const matrix = computeMatrix(regressed, { featureIds: ['scope', 'abort'] })

    // `chrome >= 100` would be a lie while 101 is broken.
    expect(matrix.floors.find(floor => floor.browser === 'chrome')?.version).toBe('102')
  })

  it('reports an unknown feature id instead of applying it', () => {
    const matrix = computeMatrix(data, { featureIds: ['scope', 'mdn-nope'] })

    expect(matrix.unresolvedFeatureIds).toEqual(['mdn-nope'])
    expect(matrix.featureIds).toEqual(['scope'])
    expect(matrix.floors.find(floor => floor.browser === 'chrome')?.version).toBe('101')
  })

  it('builds an explicit `>=` query per supported browser', () => {
    expect(computeMatrix(data, { featureIds: ['scope'] }).query).toBe('chrome >= 101')
    expect(computeMatrix(data, { featureIds: ['abort'] }).query).toBe('chrome >= 100, oldie >= 8')
  })
})

describe('computeMatrix coverage', () => {
  it('aggregates the usage of every supported version, not a per-browser threshold', () => {
    const matrix = computeMatrix(data, { featureIds: ['scope', 'abort'] })

    expect(matrix.coverage).toBe(80) // chrome 101 (20) + chrome 102 (60)
    expect(matrix.totalUsage).toBe(90)
    expect(matrix.floors.find(floor => floor.browser === 'chrome')?.usageBelowFloor).toBe(5)
  })

  it('counts every released version once the floor drops', () => {
    expect(computeMatrix(data, { featureIds: ['abort'] }).coverage).toBe(90)
  })

  it('meets the target when the aggregate reaches it', () => {
    const matrix = computeMatrix(data, { featureIds: ['scope'], target: 80 })
    expect(matrix.coverage).toBe(80)
    expect(matrix.meetsTarget).toBe(true)
  })

  it('fails the target when the aggregate falls below it', () => {
    const matrix = computeMatrix(data, { featureIds: ['scope'], target: 91 })
    expect(matrix.coverage).toBe(80)
    expect(matrix.meetsTarget).toBe(false)
  })
})
