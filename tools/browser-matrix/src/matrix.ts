/**
 * The supported browser matrix: the *intersection* of the required native
 * features, measured afterwards for aggregate global usage. Order matters —
 * `cover 91%` alone would happily include browsers with no `@scope`, so the
 * feature floor is applied first and coverage is the outcome, never the input.
 */

import { versionKey, type FeatureSupport, type SupportData, type SupportString } from './caniuse.ts'

/** The release gate fails below this aggregate global usage share. */
export const COVERAGE_TARGET_PERCENT = 91

/**
 * caniuse puts the verdict in the first space-separated token and modifier
 * flags after it. Only a plain `y` counts: partial support renders unscoped
 * styles somewhere, and `y x` (vendor prefix) would not run against the
 * unprefixed CSS and API calls the build emits.
 */
export function isFullySupported(cell: SupportString | undefined): boolean {
  if (cell === undefined) return false
  const flags = cell.split(' ')
  return flags[0] === 'y' && !flags.includes('x')
}

export interface MissingFeature {
  readonly id: string
  /** The raw caniuse cell that disqualified the version, or `n/a` if absent. */
  readonly support: SupportString
}

export interface BrowserFloor {
  readonly browser: string
  /** Lowest released version from which every required feature is supported. */
  readonly version: string
  /** Every released version at or above the floor, and their usage share. */
  readonly versions: readonly string[]
  readonly usage: number
  /** What the floor costs on this browser: usage of the versions below it. */
  readonly usageBelowFloor: number
}

export interface ExcludedBrowser {
  readonly browser: string
  readonly latestReleased: string | null
  /** What the latest released version is still missing. */
  readonly missingFeatures: readonly MissingFeature[]
  /** Aggregate global usage share lost by excluding it. */
  readonly usage: number
}

export interface BrowserMatrix {
  /** Feature ids that resolved and were applied. */
  readonly featureIds: readonly string[]
  /** Feature ids that do not exist in this caniuse-lite and were skipped. */
  readonly unresolvedFeatureIds: readonly string[]
  readonly floors: readonly BrowserFloor[]
  readonly excluded: readonly ExcludedBrowser[]
  /** Explicit browserslist query, e.g. `chrome >= 118, safari >= 17.4`. */
  readonly query: string
  /** Every supported `"<browser> <version>"` pair. */
  readonly supportedVersions: readonly string[]
  /** Measured aggregate global usage share of the matrix. */
  readonly coverage: number
  readonly target: number
  readonly meetsTarget: boolean
  /** Ceiling: caniuse's global usage data does not add up to 100%. */
  readonly totalUsage: number
}

export interface ComputeMatrixOptions {
  readonly featureIds?: readonly string[]
  readonly target?: number
}

function missingAt(
  features: readonly FeatureSupport[],
  browser: string,
  version: string,
): MissingFeature[] {
  const missing: MissingFeature[] = []
  for (const feature of features) {
    const cell = feature.stats[browser]?.[version]
    if (!isFullySupported(cell)) missing.push({ id: feature.id, support: cell ?? 'n/a' })
  }
  return missing
}

/**
 * Support must be contiguous from the newest released version downwards, so a
 * browser that shipped a feature and then removed it gets no floor below the
 * regression — which is what a `>= version` query actually promises.
 */
export function computeMatrix(
  data: SupportData,
  options: ComputeMatrixOptions = {},
): BrowserMatrix {
  const requestedIds = options.featureIds ?? []
  const target = options.target ?? COVERAGE_TARGET_PERCENT

  const features: FeatureSupport[] = []
  const unresolvedFeatureIds: string[] = []
  for (const id of requestedIds) {
    const feature = data.resolveFeature(id)
    if (feature === null) unresolvedFeatureIds.push(id)
    else features.push(feature)
  }

  const floors: BrowserFloor[] = []
  const excluded: ExcludedBrowser[] = []

  for (const browser of [...data.browsers].sort()) {
    const released = data.releasedVersions(browser)
    const usageOf = (versions: readonly string[]): number =>
      versions.reduce((total, version) => total + data.usage(browser, version), 0)

    let floorIndex = released.length
    while (floorIndex > 0) {
      const candidate = released[floorIndex - 1]
      if (candidate === undefined) break
      if (missingAt(features, browser, candidate).length > 0) break
      floorIndex -= 1
    }

    const latestReleased = released[released.length - 1] ?? null
    if (floorIndex === released.length) {
      excluded.push({
        browser,
        latestReleased,
        missingFeatures:
          latestReleased === null ? [] : missingAt(features, browser, latestReleased),
        usage: usageOf(released),
      })
      continue
    }

    const versions = released.slice(floorIndex)
    const version = versions[0]
    if (version === undefined) continue
    floors.push({
      browser,
      version,
      versions,
      usage: usageOf(versions),
      usageBelowFloor: usageOf(released.slice(0, floorIndex)),
    })
  }

  const supportedVersions = floors.flatMap(floor =>
    floor.versions.map(version => versionKey(floor.browser, version)),
  )
  const coverage = data.coverage(supportedVersions)

  return {
    featureIds: features.map(feature => feature.id),
    unresolvedFeatureIds,
    floors,
    excluded: [...excluded].sort((a, b) => b.usage - a.usage),
    query: floors.map(floor => `${floor.browser} >= ${floor.version}`).join(', '),
    supportedVersions,
    coverage,
    target,
    meetsTarget: coverage >= target,
    totalUsage: data.totalUsage(),
  }
}
