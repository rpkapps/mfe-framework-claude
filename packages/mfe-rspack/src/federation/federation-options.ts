/** The contract metadata rides in the MF2 manifest's metadata area; a second would disagree. */

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
    // A remote that hands out its types over HTTP makes a build depend on a running deployment.
    dts: false,
    // The generated entries await the configuration module, so the entry starts asynchronously.
    experiments: { asyncStartup: true },
  }
}

/**
 * Injected into the emitted asset rather than through the federation plugin's own
 * `manifest.additionalData`, which Rsbuild replaces so that it is never called (§13).
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
