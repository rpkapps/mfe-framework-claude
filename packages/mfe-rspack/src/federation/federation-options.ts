/**
 * The Module Federation options, which an author never writes. The framework
 * contract metadata rides in the MF2 manifest's own metadata area under an
 * `mfe` key rather than in a second manifest: a competing manifest would
 * eventually disagree with this one and nothing would say which was right.
 */

import type { FrameworkManifestMetadata } from '../generate/artifacts.ts'
import type { ContainerPlan } from '../plan.ts'
import type { SharedModuleConfig } from './sharing.ts'

const MANIFEST_METADATA_KEY = 'mfe'

export interface FederationOptions {
  readonly name: string
  readonly filename: string
  readonly exposes: Readonly<Record<string, string>>
  readonly shared: Readonly<Record<string, SharedModuleConfig>>
  readonly manifest: { readonly fileName: string }
  readonly dts: false
  readonly experiments: { readonly asyncStartup: true }
}

export function buildFederationOptions(plan: ContainerPlan): FederationOptions {
  return {
    name: plan.options.federationName,
    filename: 'remoteEntry.js',
    exposes: plan.exposes,
    shared: plan.shared,
    manifest: { fileName: plan.options.manifestFileName },
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
 *
 * The federation plugin's own `manifest.additionalData` hook would be the
 * obvious place, but Rsbuild replaces the `manifest` option when it registers
 * the plugin and the hook is never called — silently, with a manifest that
 * simply lacks the metadata. The Rspack half injects it into the emitted asset
 * instead, which depends on nothing but the file being there.
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
