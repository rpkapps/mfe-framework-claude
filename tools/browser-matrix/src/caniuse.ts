/**
 * Everything the matrix needs from `browserslist` and `caniuse-lite` goes
 * through the {@link SupportData} port, so the intersection and coverage logic
 * runs against a fixed, tiny dataset in tests while the gate runs against the
 * real pinned data.
 */

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/** A raw caniuse support cell: `y`, `y x`, `a #1`, `n d`. */
export type SupportString = string

export interface FeatureSupport {
  readonly id: string
  readonly title: string
  /** browser id -> version -> raw caniuse support cell. */
  readonly stats: Readonly<Record<string, Readonly<Record<string, SupportString>> | undefined>>
}

export interface SupportData {
  /** Recorded alongside the measured coverage, as the policy requires. */
  readonly caniuseVersion: string
  readonly browserslistVersion: string
  /** Every browser id browserslist knows about, e.g. `chrome`, `ios_saf`. */
  readonly browsers: readonly string[]
  /** Released versions, oldest first. Unreleased betas are excluded. */
  releasedVersions(browser: string): readonly string[]
  /** The feature, or `null` when the id does not exist in this caniuse-lite. */
  resolveFeature(id: string): FeatureSupport | null
  /** Aggregate global usage share of `"<browser> <version>"` entries. */
  coverage(versions: readonly string[]): number
  usage(browser: string, version: string): number
  /** The ceiling any matrix can reach: caniuse global data does not sum to 100%. */
  totalUsage(): number
}

interface BrowserslistModule {
  (query: string | readonly string[]): string[]
  coverage(browsers: readonly string[], country?: string): number
  data: Record<string, { released: string[] } | undefined>
  usage: { global?: Record<string, number> }
}

interface PackedFeature {
  title: string
  stats: Record<string, Record<string, SupportString>>
}

/** Formats a browserslist usage/coverage key. */
export function versionKey(browser: string, version: string): string {
  return `${browser} ${version}`
}

/**
 * `createRequire` is deliberate: `caniuse-lite` ships one CommonJS module per
 * feature and the id is only known at runtime, so they cannot be static imports.
 */
export function loadSupportData(): SupportData {
  const browserslist = require('browserslist') as BrowserslistModule
  const unpackFeature = (
    require('caniuse-lite/dist/unpacker/feature.js') as {
      default: (packed: PackedFeature) => PackedFeature
    }
  ).default

  // Touching a query forces browserslist to populate its lazy usage tables
  // before anything reads `usage.global`.
  browserslist('> 0%')
  const globalUsage = browserslist.usage.global ?? {}

  const cache = new Map<string, FeatureSupport | null>()

  return {
    caniuseVersion: (require('caniuse-lite/package.json') as { version: string }).version,
    browserslistVersion: (require('browserslist/package.json') as { version: string }).version,
    browsers: Object.keys(browserslist.data),
    releasedVersions(browser) {
      return browserslist.data[browser]?.released ?? []
    },
    resolveFeature(id) {
      const cached = cache.get(id)
      if (cached !== undefined) return cached
      let feature: FeatureSupport | null
      try {
        const unpacked = unpackFeature(
          require(`caniuse-lite/data/features/${id}.js`) as PackedFeature,
        )
        feature = { id, title: unpacked.title, stats: unpacked.stats }
      } catch {
        // An unknown id is a policy input error, not a crash: the report names
        // it and carries on with the ids that do resolve.
        feature = null
      }
      cache.set(id, feature)
      return feature
    },
    coverage(versions) {
      return browserslist.coverage([...versions])
    },
    usage(browser, version) {
      return globalUsage[versionKey(browser, version)] ?? 0
    },
    totalUsage() {
      let total = 0
      for (const share of Object.values(globalUsage)) total += share
      return total
    },
  }
}
