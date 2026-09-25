/**
 * The contract every host places every definition through: the definition mounts itself into an
 * element the host provides, given its mount context, and hands back what the host needs to
 * update and dispose it. No host renders a definition's tree itself, not even one its own
 * framework built, so placing a definition needs nothing from the adapter that built it.
 *
 * The runtime owns both roots a mount has. It creates the scope root, which carries the
 * attributes the container's scoped stylesheet matches, with `target.element` inside it, and the
 * body-level overlay root on the context. A definition renders into `target.element`, portals
 * into `context.overlayRoot`, and never adds a root of its own.
 *
 * Validation is split the way a Widget boundary splits it everywhere. The provider — the
 * definition's `mount` — checks inputs for serializability and against its own schema, and every
 * payload it emits against its own output schema, throwing in its own stack. Those checks are
 * `validateProviderInputs` and `createProviderEmit`. The host checks only what the consumer
 * declared, and routes outputs to its handlers.
 */

import {
  isBrandedDefinition,
  type BrandedDefinition,
  type MfeError,
  type WidgetContract,
} from '@company/mfe-core'

import type { MountContext } from './mount-context.ts'

export interface WidgetMountTarget {
  /** Inside the host's scope root; the definition renders into it and must leave it in place. */
  readonly element: HTMLElement
  readonly context: MountContext
  /** Raw consumer inputs; the provider validates them against its own contract. */
  readonly inputs: Readonly<Record<string, unknown>>
  /** Called by the provider after validating the payload against its own output schema. */
  readonly emit: (output: string, payload: unknown) => void
  /**
   * A later input update the provider rejected; the mount keeps its last valid inputs. The
   * provider has already reported it to the runtime's diagnostics, so a host that reports it
   * again counts one rejection twice.
   */
  readonly onInputRejected?: (error: MfeError) => void
  /** A fatal failure after the mount resolved; see `AppMountTarget.onFailure`. `mountDefinition` always provides it. */
  readonly onFailure: (error: unknown) => void
}

export interface AppMountTarget {
  /** Inside the host's scope root; the definition renders into it and must leave it in place. */
  readonly element: HTMLElement
  /** The navigation bridge is `context.runtime.navigator`. */
  readonly context: MountContext
  /**
   * A fatal failure after the mount resolved, such as a framework root that unmounted itself.
   * The mount moves to its error state and is torn down, so the host can offer a retry rather
   * than a blank area. A failure before the mount resolves rejects the mount instead.
   * `mountDefinition` always provides it.
   */
  readonly onFailure: (error: unknown) => void
}

export interface MountedWidget {
  /**
   * Replace the inputs; invalid inputs are reported through `onInputRejected`, not thrown. Called
   * only when they changed: the host drops a set shallow-equal to the last one it passed on.
   */
  update(inputs: Readonly<Record<string, unknown>>): void
  /**
   * Empties the element it was given. Called once, asynchronously rather than from inside a
   * host's render, and before the host disposes the mount context.
   */
  dispose(): Promise<void>
  /** See `MountedApp.whenStable`. */
  whenStable?(): Promise<void>
}

export interface MountedApp {
  /**
   * Empties the element it was given. Called once, asynchronously rather than from inside a
   * host's render, and before the host disposes the mount context.
   */
  dispose(): Promise<void>
  /**
   * Resolves once the definition's framework has rendered what it was last given, so a test can
   * wait on the mount rather than guess at its scheduler. Without it, a definition is taken to
   * render synchronously.
   */
  whenStable?(): Promise<void>
}

export interface MountableWidgetDefinition extends BrandedDefinition {
  readonly kind: 'widget'
  readonly contract: WidgetContract
  /** Rejects with the `MfeError` when the first inputs fail the provider's own contract. */
  mount(target: WidgetMountTarget): Promise<MountedWidget>
}

export interface MountableAppDefinition extends BrandedDefinition {
  readonly kind: 'app'
  readonly contributesBreadcrumbs: boolean
  mount(target: AppMountTarget): Promise<MountedApp>
}

export type MountableDefinition = MountableAppDefinition | MountableWidgetDefinition

/**
 * Checks what a host reads before mounting — the brand, `mount`, and for a Widget the contract
 * whose output names the host routes — so a malformed record fails here rather than mid-mount.
 */
export function isMountableDefinition(value: unknown): value is MountableDefinition {
  if (!isBrandedDefinition(value)) return false

  const candidate = value as unknown as Record<string, unknown>
  if (typeof candidate['mount'] !== 'function') return false

  if (value.kind === 'app') return typeof candidate['contributesBreadcrumbs'] === 'boolean'
  return isWidgetContract(candidate['contract'])
}

function isWidgetContract(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || !('inputSchema' in value)) return false
  const outputSchema = (value as Record<string, unknown>)['outputSchema']
  if (outputSchema === null || typeof outputSchema !== 'object') return false
  const shape = (outputSchema as Record<string, unknown>)['shape']
  return shape !== null && typeof shape === 'object'
}
