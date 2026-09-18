/**
 * The single-spa parcel contract, expressed structurally.
 *
 * This package is the only one that may know this contract exists. It is
 * described here as plain interfaces rather than imported, for two reasons:
 * the shapes are what the legacy containers actually export, and a structural
 * description lets every test drive the lifecycle with a double instead of a
 * real single-spa runtime, a real Angular app or a bundler.
 *
 * `single-spa` may be installed alongside as an optional peer; nothing in this
 * package imports it.
 */

/** The props single-spa passes through every parcel lifecycle call. */
export interface LegacyParcelProps {
  /** The element the legacy app renders into. Owned by the shell. */
  readonly domElement: HTMLElement
  /** The activity name, which is the legacy registry name. */
  readonly name?: string
  /** The base href single-spa supplies. One of the two documented seams. */
  readonly baseHref?: string
  readonly [key: string]: unknown
}

export type LegacyLifecycleFn = (props: LegacyParcelProps) => Promise<unknown> | unknown

/**
 * What `<name>/single-spa-app` exports. single-spa allows a lifecycle to be a
 * single function or an array of them, and the legacy Angular helper emits
 * arrays, so both are accepted.
 */
export interface LegacyParcelConfig {
  readonly bootstrap: LegacyLifecycleFn | readonly LegacyLifecycleFn[]
  readonly mount: LegacyLifecycleFn | readonly LegacyLifecycleFn[]
  readonly unmount: LegacyLifecycleFn | readonly LegacyLifecycleFn[]
  readonly update?: LegacyLifecycleFn | readonly LegacyLifecycleFn[]
}

/** The handle `mountRootParcel` returns. */
export interface LegacyParcel {
  /** Resolves when the parcel finished mounting; rejects when it failed. */
  readonly mountPromise: Promise<unknown>
  readonly bootstrapPromise?: Promise<unknown>
  unmount(): Promise<unknown>
  getStatus?(): string
}

/** single-spa's `mountRootParcel`, injected so no runtime is needed in tests. */
export type MountRootParcel = (
  config: LegacyParcelConfig,
  props: LegacyParcelProps,
) => LegacyParcel

function isLifecycle(value: unknown): boolean {
  if (typeof value === 'function') return true
  return Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'function')
}

/** Structural check for a module that can be mounted as a parcel. */
export function isLegacyParcelConfig(value: unknown): value is LegacyParcelConfig {
  if (value === null || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    isLifecycle(candidate['bootstrap']) &&
    isLifecycle(candidate['mount']) &&
    isLifecycle(candidate['unmount'])
  )
}

/** Names the lifecycles a module is missing, for a diagnostic worth reading. */
export function missingParcelLifecycles(value: unknown): readonly string[] {
  if (value === null || typeof value !== 'object') return ['bootstrap', 'mount', 'unmount']
  const candidate = value as Record<string, unknown>
  return ['bootstrap', 'mount', 'unmount'].filter(name => !isLifecycle(candidate[name]))
}
