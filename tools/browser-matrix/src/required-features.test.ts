/**
 * These run against the real pinned caniuse-lite: they are what keeps the
 * policy honest across a quarterly data refresh.
 */

import { describe, expect, it } from 'vitest'

import { loadSupportData, versionKey } from './caniuse.ts'
import { computeMatrix } from './matrix.ts'
import { CONSIDERED_FEATURES, REQUIRED_FEATURES } from './required-features.ts'

const data = loadSupportData()

describe('required feature ids', () => {
  it.each(REQUIRED_FEATURES.map(feature => feature.id))('`%s` resolves in caniuse-lite', id => {
    expect(data.resolveFeature(id)).not.toBeNull()
  })

  it('resolves every id the matrix applies, so nothing is silently skipped', () => {
    const matrix = computeMatrix(data, {
      featureIds: REQUIRED_FEATURES.map(feature => feature.id),
    })
    expect(matrix.unresolvedFeatureIds).toEqual([])
  })

  it.each(CONSIDERED_FEATURES)(
    'documents `$id` accurately (resolves: $resolves)',
    ({ id, resolves }) => {
      expect(data.resolveFeature(id) !== null).toBe(resolves)
    },
  )
})

describe('real matrix', () => {
  const matrix = computeMatrix(data, { featureIds: REQUIRED_FEATURES.map(feature => feature.id) })

  it('keeps the evergreen desktop and mobile engines', () => {
    const browsers = matrix.floors.map(floor => floor.browser)
    expect(browsers).toEqual(expect.arrayContaining(['chrome', 'edge', 'firefox', 'safari']))
  })

  it('excludes engines that will never ship the feature floor', () => {
    const excluded = matrix.excluded.map(entry => entry.browser)
    expect(excluded).toEqual(expect.arrayContaining(['ie', 'op_mini']))
  })

  it('measures coverage with browserslist, which agrees with the per-version usage data', () => {
    const summed = matrix.supportedVersions.reduce((total, key) => {
      const index = key.lastIndexOf(' ')
      return total + data.usage(key.slice(0, index), key.slice(index + 1))
    }, 0)

    expect(matrix.coverage).toBeCloseTo(summed, 6)
    expect(matrix.coverage).toBeGreaterThan(0)
    expect(matrix.coverage).toBeLessThanOrEqual(matrix.totalUsage)
  })

  it('produces a browserslist query that selects exactly the matrix', () => {
    expect(matrix.query.split(', ')).toHaveLength(matrix.floors.length)
    for (const floor of matrix.floors) {
      expect(matrix.supportedVersions).toContain(versionKey(floor.browser, floor.version))
    }
  })
})
