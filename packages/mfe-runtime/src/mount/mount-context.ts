/**
 * Deriving one mount from the runtime: anything on the context is owned by that mount and torn
 * down with it, whichever adapter renders the definition, and anything on the runtime outlives it.
 */

import {
  withoutUndefined,
  type DefinitionKind,
  type MfeStorage,
  type MfeTelemetry,
} from '@company/mfe-core'

import type { MfeRuntime } from '../runtime/create-runtime.ts'
import { createMountTelemetry } from '../telemetry/service.ts'
import { applyScopeAttributes, createOverlayRoot } from './scope-root.ts'

/** Everything one mount owns. */
export interface MountContext {
  readonly runtime: MfeRuntime
  readonly definitionId: string
  readonly definitionVersion: string | undefined
  readonly kind: DefinitionKind
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
  /**
   * The element carrying this mount's scope attributes, which its scoped stylesheet matches.
   * Created with the context, detached, and placed by whoever places the mount — `mountDefinition`
   * for every host; the definition renders inside it, never replaces it.
   */
  readonly scopeRoot: HTMLElement
  /** Framework-created body-level root for overlays raised by this mount. */
  readonly overlayRoot: HTMLElement
}

export interface CreateMountContextOptions {
  readonly runtime: MfeRuntime
  readonly definitionId: string
  readonly definitionVersion?: string
  readonly kind: DefinitionKind
  /** The assigned URL boundary, always `''` for a Widget. */
  readonly basePath?: string
  /** The enclosing mount's depth plus one; 1, a top-level mount, when omitted. */
  readonly depth?: number
  /** Where both roots are created; the page's own when omitted. */
  readonly document?: Document
}

export interface MountContextHandle {
  readonly context: MountContext
  /** Tears down everything this mount owns; the ordering is deliberate. */
  dispose(): Promise<void>
}

let nextMountSequence = 0

/** Unique per document and stable for the mount's life is all a token needs. */
export function createMountToken(definitionId: string): string {
  nextMountSequence += 1
  return `${definitionId}#${nextMountSequence}`
}

export function createMountContext(options: CreateMountContextOptions): MountContextHandle {
  const { runtime, definitionId, kind } = options
  const mountToken = createMountToken(definitionId)
  const disposal = new AbortController()

  const telemetry = createMountTelemetry(runtime.telemetryProvider, {
    definitionId,
    definitionKind: kind,
    ...withoutUndefined({ definitionVersion: options.definitionVersion }),
    mountToken,
  })

  // Both roots are created here, so the token stamped on them is always this context's own.
  const ownerDocument = options.document ?? document
  const scopeRoot = ownerDocument.createElement('div')
  applyScopeAttributes(scopeRoot, { definitionId, mountToken, kind })
  const overlay = createOverlayRoot(definitionId, mountToken, ownerDocument)

  const context: MountContext = {
    runtime,
    definitionId,
    definitionVersion: options.definitionVersion,
    kind,
    mountToken,
    depth: options.depth ?? 1,
    basePath: kind === 'widget' ? '' : (options.basePath ?? ''),
    telemetry,
    storage: {
      local: runtime.storage.storageFor(definitionId, 'local'),
      session: runtime.storage.storageFor(definitionId, 'session'),
    },
    signal: disposal.signal,
    scopeRoot,
    overlayRoot: overlay.element,
  }

  return {
    context,
    dispose: async () => {
      // Registrations go first, so a disposed mount cannot appear in the palette mid-teardown.
      runtime.actions.removeMount(mountToken)
      runtime.navigator.removeMount(mountToken)

      // Synchronous, so work an adapter stops on abort ends before telemetry is closed below.
      disposal.abort()
      telemetry.dispose()
      overlay.dispose()

      await Promise.resolve()
    },
  }
}
