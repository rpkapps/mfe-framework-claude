/**
 * The runtime a shell installs once and the per-mount context derived from it: anything on
 * `MfeMount` is destroyed with that mount, anything on `MfeRuntime` outlives it.
 */

import type {
  DiagnosticsHub,
  MfeStorage,
  MfeTelemetry,
  NormalizedRegistry,
  TelemetryProvider,
} from '@company/mfe-core'
import type {
  BoundaryNavigator,
  BreadcrumbStore,
  CommandRegistry,
  ContainerLoader,
  MfeStorageStore,
  ShellStateStore,
} from '@company/mfe-host'
import type { QueryClient } from '@tanstack/react-query'

/** Shared, shell-owned services, one instance per document. */
export interface MfeRuntime {
  readonly registry: NormalizedRegistry
  readonly loader: ContainerLoader
  readonly shellState: ShellStateStore
  readonly storage: MfeStorageStore
  readonly commands: CommandRegistry
  readonly breadcrumbs: BreadcrumbStore
  readonly navigator: BoundaryNavigator
  readonly telemetryProvider: TelemetryProvider
  readonly diagnostics: DiagnosticsHub
}

/** Everything one mount owns. */
export interface MfeMount {
  readonly runtime: MfeRuntime
  readonly definitionId: string
  readonly definitionVersion: string | undefined
  readonly kind: 'app' | 'widget'
  /** Internal bookkeeping that isolates duplicate mounts; never public API. */
  readonly mountToken: string
  /** Shell is 0, a top-level App 1, an App nested inside it 2, and so on. */
  readonly depth: number
  /** The App's assigned URL boundary, always `''` for a Widget. */
  readonly basePath: string
  readonly telemetry: MfeTelemetry
  readonly storage: {
    readonly local: MfeStorage
    readonly session: MfeStorage
  }
  /** Aborts on disposal. */
  readonly signal: AbortSignal
  readonly queryClient: QueryClient
  /** Framework-created body-level root for overlays raised by this mount. */
  readonly overlayRoot: HTMLElement
}

let nextMountSequence = 0

/** Unique per document and stable for the mount's life is all a token needs. */
export function createMountToken(definitionId: string): string {
  nextMountSequence += 1
  return `${definitionId}#${nextMountSequence}`
}
