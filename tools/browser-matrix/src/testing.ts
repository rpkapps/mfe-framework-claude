/**
 * An in-memory {@link SupportData} so the intersection, coverage and gate logic
 * can be tested against a fixed dataset instead of whatever caniuse-lite
 * happens to be pinned at. Test-only, not part of the package's public surface.
 */

import { versionKey, type FeatureSupport, type SupportData, type SupportString } from './caniuse.ts'

export interface FakeBrowser {
  /** Released versions, oldest first. */
  readonly released: readonly string[]
  /** version -> global usage share, in percent. */
  readonly usage?: Readonly<Record<string, number>>
}

export interface FakeDataSpec {
  readonly browsers: Readonly<Record<string, FakeBrowser>>
  /** feature id -> browser id -> version -> raw caniuse support cell. */
  readonly features: Readonly<
    Record<string, Readonly<Record<string, Readonly<Record<string, SupportString>>>>>
  >
  readonly caniuseVersion?: string
  readonly browserslistVersion?: string
}

export function createFakeSupportData(spec: FakeDataSpec): SupportData {
  const usageByKey = new Map<string, number>()
  for (const [browser, entry] of Object.entries(spec.browsers)) {
    for (const [version, share] of Object.entries(entry.usage ?? {})) {
      usageByKey.set(versionKey(browser, version), share)
    }
  }

  const usage = (browser: string, version: string): number =>
    usageByKey.get(versionKey(browser, version)) ?? 0

  return {
    caniuseVersion: spec.caniuseVersion ?? '1.0.0-fake',
    browserslistVersion: spec.browserslistVersion ?? '0.0.0-fake',
    browsers: Object.keys(spec.browsers),
    releasedVersions(browser) {
      return spec.browsers[browser]?.released ?? []
    },
    resolveFeature(id): FeatureSupport | null {
      const stats = spec.features[id]
      if (stats === undefined) return null
      return { id, title: id, stats }
    },
    // browserslist.coverage() is a plain sum of the per-version usage shares;
    // the fake mirrors that, and `caniuse.test.ts` asserts the real loader agrees.
    coverage(versions) {
      let total = 0
      for (const key of versions) total += usageByKey.get(key) ?? 0
      return total
    },
    usage,
    totalUsage() {
      let total = 0
      for (const share of usageByKey.values()) total += share
      return total
    },
  }
}
