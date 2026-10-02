/** Detached diagnostic data: no services, DOM nodes, inputs or raw error objects. */

import type { BuildProvenance, DefinitionKind } from './definition.ts'
import type { MfeErrorCode } from './errors.ts'

export interface RuntimeDefinitionSnapshot {
  readonly id: string
  readonly kind: DefinitionKind
  readonly adapter: string
  readonly version?: string
  readonly build?: BuildProvenance
  readonly overridden: boolean
}

export interface RuntimeRejectedEntrySnapshot {
  readonly id: string
  readonly reason: string
  readonly errorCode?: MfeErrorCode
}

export interface RuntimeMountSnapshot {
  /** Opaque placement identity, stable across retries; not a storage key or scope token. */
  readonly mountId: string
  readonly definitionId: string
  readonly kind: DefinitionKind
  readonly status: 'pending' | 'mounted' | 'error'
  readonly attempt: number
  readonly depth: number
  /** Loaded definition metadata when available; registry metadata before loading. */
  readonly version?: string
  readonly adapter?: string
  readonly errorCode?: MfeErrorCode
}

/** An on-demand point-in-time report, not a reactive or cached snapshot. */
export interface RuntimeSnapshot {
  readonly apiVersion: string
  /** Milliseconds since the Unix epoch. */
  readonly capturedAt: number
  readonly mounts: readonly RuntimeMountSnapshot[]
  readonly registry: {
    readonly entries: readonly RuntimeDefinitionSnapshot[]
    readonly rejected: readonly RuntimeRejectedEntrySnapshot[]
  }
}
