/**
 * The Module Federation options the plugin derives for a container.
 *
 * An author never writes any of this. Names, exposes, share scope, singleton
 * flags, the manifest and the framework metadata inside it only work when every
 * container in a page agrees on them, and a per-repository config file cannot
 * make that promise.
 *
 * The framework contract metadata rides in the MF2 manifest's own metadata
 * area, under an `mfe` key, rather than in a second manifest of our own. One
 * manifest means one thing to fetch, one thing to cache and one thing that can
 * be out of date; a competing manifest would eventually disagree with this one,
 * and nothing would say which was right.
 */

import type { FrameworkManifestMetadata } from '../generate/artifacts.ts'
import type { ContainerPlan } from '../plan.ts'

/** The key the framework metadata occupies inside the manifest metadata. */
export const MANIFEST_METADATA_KEY = 'mfe'

export interface FederationOptions {
  readonly name: string
  readonly filename: string
  readonly exposes: Readonly<Record<string, string>>
  readonly shared: Readonly<Record<string, unknown>>
  readonly manifest: {
    readonly fileName: string
    readonly additionalData: (options: { readonly stats: Record<string, unknown> }) => unknown
  }
  readonly dts: false
  readonly experiments: { readonly asyncStartup: true }
}

export function buildFederationOptions(plan: ContainerPlan): FederationOptions {
  const metadata = plan.generated.frameworkMetadata

  return {
    name: plan.options.federationName,
    filename: 'remoteEntry.js',
    exposes: plan.exposes,
    shared: plan.shared,
    manifest: {
      fileName: plan.options.manifestFileName,
      additionalData: ({ stats }) => withFrameworkMetadata(stats, metadata),
    },
    // Types are published from the container's own package, not from the
    // manifest: a remote that hands out its types over HTTP makes a build
    // depend on a running deployment.
    dts: false,
    // The generated entries await the configuration module, so the container
    // entry has to tolerate an asynchronous start.
    experiments: { asyncStartup: true },
  }
}

/**
 * Adds the framework contract metadata to the manifest the MF2 plugin wrote,
 * leaving everything else in it untouched.
 */
export function withFrameworkMetadata(
  stats: Record<string, unknown>,
  metadata: FrameworkManifestMetadata,
): Record<string, unknown> {
  const existing = stats['metaData']
  const metaData =
    existing !== null && typeof existing === 'object' ? (existing as Record<string, unknown>) : {}

  return { ...stats, metaData: { ...metaData, [MANIFEST_METADATA_KEY]: metadata } }
}
