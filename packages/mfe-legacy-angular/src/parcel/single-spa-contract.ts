/**
 * The single-spa parcel contract as plain interfaces rather than an import:
 * these are the shapes the legacy containers actually export, and a structural
 * description lets every test drive the lifecycle without single-spa, Angular
 * or a bundler. Nothing in this package imports or depends on `single-spa`.
 */

/** The props single-spa passes through every parcel lifecycle call. */
export interface LegacyParcelProps {
  /** The element the legacy app renders into. Owned by the shell. */
  readonly domElement: HTMLElement
  readonly name?: string
  /** The base href single-spa supplies. One of the two documented seams. */
  readonly baseHref?: string
  readonly [key: string]: unknown
}

/**
 * The return type stays loose because a legacy lifecycle that forgets its
 * promise still has to be awaited rather than rejected at the type level.
 */
export type LegacyLifecycleFn = (props: LegacyParcelProps) => Promise<unknown> | void

/**
 * What `<name>/single-spa-app` exports. single-spa allows a lifecycle to be one
 * function or an array of them, and the legacy Angular helper emits arrays.
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
export type MountRootParcel = (config: LegacyParcelConfig, props: LegacyParcelProps) => LegacyParcel

function isLifecycle(value: unknown): boolean {
  if (typeof value === 'function') return true
  return Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'function')
}

/** Names the lifecycles a module is missing, for a diagnostic worth reading. */
export function missingParcelLifecycles(value: unknown): readonly string[] {
  if (value === null || typeof value !== 'object') return ['bootstrap', 'mount', 'unmount']
  const candidate = value as Record<string, unknown>
  return ['bootstrap', 'mount', 'unmount'].filter(name => !isLifecycle(candidate[name]))
}

export function isLegacyParcelConfig(value: unknown): value is LegacyParcelConfig {
  return missingParcelLifecycles(value).length === 0
}
