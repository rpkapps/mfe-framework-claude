/**
 * Data access for the §9.2 browser support policy.
 *
 * Everything the matrix needs from `browserslist` and `caniuse-lite` goes
 * through the {@link SupportData} port, so the intersection and coverage logic
 * can be exercised against a fixed, tiny dataset in tests while the release
 * gate runs against the real, pinned data.
 */

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/**
 * A raw caniuse support cell, e.g. `y`, `y x` (needs a vendor prefix),
 * `a #1` (partial support, footnote 1), `n d` (behind a flag).
 */
export type SupportString = string

export interface FeatureSupport {
  readonly id: string
  /** caniuse title, kept so the report can name the feature in prose. */
  readonly title: string
  /** browser id -> version -> raw caniuse support cell. */
  readonly stats: Readonly<Record<string, Readonly<Record<string, SupportString>> | undefined>>
}

export interface SupportData {
  /** Exact `caniuse-lite` version the matrix was derived from (§9.2 records it). */
  readonly caniuseVersion: string
  /** Exact `browserslist` version whose query and usage data were used. */
  readonly browserslistVersion: string
  /** Every browser id browserslist knows about, e.g. `chrome`, `ios_saf`. */
  readonly browsers: readonly string[]
  /** Released versions of a browser, oldest first. Unreleased betas are excluded. */
  releasedVersions(browser: string): readonly string[]
  /** The feature, or `null` when the id does not exist in this caniuse-lite. */
  resolveFeature(id: string): FeatureSupport | null
  /** Aggregate global usage share of `"<browser> <version>"` entries. */
  coverage(versions: readonly string[]): number
  /** Global usage share of a single browser version. */
  usage(browser: string, version: string): number
  /**
   * Total usage share the dataset accounts for. caniuse's global data does not
   * sum to 100%, so this is the ceiling any matrix can reach.
   */
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
 * Loads the real, pinned data. `createRequire` is used deliberately:
 * `caniuse-lite` ships one CommonJS module per feature and the id is only known
 * at runtime, so the feature files cannot be static ESM imports.
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
      let feature: FeatureSupport | null = null
      try {
        const packed = require(`caniuse-lite/data/features/${id}.js`) as PackedFeature
        const unpacked = unpackFeature(packed)
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
