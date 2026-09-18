/**
 * The runtime a shell installs once, and the per-mount context derived from it.
 *
 * The shell owns one runtime; every mount gets a context built from it. Keeping
 * the split explicit is what makes mount-scoped ownership traceable: anything
 * on `MfeMount` is created and destroyed with that mount, and anything on
 * `MfeRuntime` outlives it.
 */

import type {
  DeadlineConfig,
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

/** Shared, shell-owned services. One instance per document. */
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
  readonly deadlines: DeadlineConfig
}

/**
 * Everything one mount owns.
 *
 * `mountToken` is an internal bookkeeping value used to isolate duplicate
 * mounts, scope DOM roots and attribute registrations. It is never public API:
 * authors neither set nor read it.
 */
export interface MfeMount {
  readonly runtime: MfeRuntime
  readonly definitionId: string
  readonly definitionVersion: string | undefined
  readonly kind: 'app' | 'widget'
  readonly mountToken: string
  /** Shell is 0, a top-level App 1, an App nested inside it 2, and so on. */
  readonly depth: number
  /** The App's assigned URL boundary. Always `''` for a Widget. */
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

/**
 * Mount tokens only need to be unique within a document and stable for the
 * mount's life. A counter is enough and keeps them readable in diagnostics.
 */
export function createMountToken(definitionId: string): string {
  nextMountSequence += 1
  return `${definitionId}#${nextMountSequence}`
}

/** Test-only reset so token values stay predictable across isolated tests. */
export function resetMountTokenSequence(): void {
  nextMountSequence = 0
}
