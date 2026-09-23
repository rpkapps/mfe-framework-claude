/**
 * The contract that lets a host mount a definition some other framework built: the definition
 * mounts itself into an element the host provides, given the host's mount context, and hands
 * back what the host needs to update and dispose it. A React shell cannot render an Angular
 * component tree, so this is the only way one framework's host places another framework's
 * container.
 *
 * Validation is split the way a Widget boundary splits it everywhere. The provider — the
 * definition's `mount` — checks inputs for serializability and against its own schema, and every
 * payload it emits against its own event schema, throwing in its own stack. The host checks only
 * what the consumer declared, and routes events to its handlers.
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
  /** Called by the provider after validating the payload against its own event schema. */
  readonly emit: (event: string, payload: unknown) => void
  /**
   * A later input update the provider rejected; the mount keeps its last valid inputs. The
   * provider has already reported it to the runtime's diagnostics, so a host that reports it
   * again counts one rejection twice.
   */
  readonly onInputRejected?: (error: MfeError) => void
}

export interface AppMountTarget {
  /** Inside the host's scope root; the definition renders into it and must leave it in place. */
  readonly element: HTMLElement
  /** The navigation bridge is `context.runtime.navigator`. */
  readonly context: MountContext
}

export interface MountedWidget {
  /** Replace the inputs; invalid inputs are reported through `onInputRejected`, not thrown. */
  update(inputs: Readonly<Record<string, unknown>>): void
  /** Empties the element it was given; the host disposes the mount context afterwards. */
  dispose(): Promise<void>
}

export interface MountedApp {
  /** Empties the element it was given; the host disposes the mount context afterwards. */
  dispose(): Promise<void>
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
 * whose event names the host routes — so a malformed record fails here rather than mid-mount.
 */
export function isMountableDefinition(value: unknown): value is MountableDefinition {
  if (!isBrandedDefinition(value)) return false

  const candidate = value as unknown as Record<string, unknown>
  if (typeof candidate['mount'] !== 'function') return false

  if (value.kind === 'app') return typeof candidate['contributesBreadcrumbs'] === 'boolean'
  return isWidgetContract(candidate['contract'])
}

function isWidgetContract(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || !('inputs' in value)) return false
  const events = (value as Record<string, unknown>)['events']
  return events !== null && typeof events === 'object'
}
