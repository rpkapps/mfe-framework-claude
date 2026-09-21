/** The single-spa parcel contract as plain interfaces; nothing in this package imports `single-spa`. */

export interface LegacyParcelProps {
  /** The element the legacy app renders into; the shell owns it. */
  readonly domElement: HTMLElement
  readonly name?: string
  /** The base href single-spa supplies, one of the two documented seams. */
  readonly baseHref?: string
  readonly [key: string]: unknown
}

/** Loose on purpose: a legacy lifecycle that forgets its promise still has to be awaited. */
export type LegacyLifecycleFn = (props: LegacyParcelProps) => Promise<unknown> | void

/** What `<name>/single-spa-app` exports; the legacy Angular helper emits arrays of lifecycles. */
export interface LegacyParcelConfig {
  readonly bootstrap: LegacyLifecycleFn | readonly LegacyLifecycleFn[]
  readonly mount: LegacyLifecycleFn | readonly LegacyLifecycleFn[]
  readonly unmount: LegacyLifecycleFn | readonly LegacyLifecycleFn[]
  readonly update?: LegacyLifecycleFn | readonly LegacyLifecycleFn[]
}

/** The handle `mountRootParcel` returns. */
export interface LegacyParcel {
  readonly mountPromise: Promise<unknown>
  readonly bootstrapPromise?: Promise<unknown>
  unmount(): Promise<unknown>
  getStatus?(): string
}

export type MountRootParcel = (config: LegacyParcelConfig, props: LegacyParcelProps) => LegacyParcel

function isLifecycle(value: unknown): boolean {
  if (typeof value === 'function') return true
  return Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'function')
}

export function missingParcelLifecycles(value: unknown): readonly string[] {
  if (value === null || typeof value !== 'object') return ['bootstrap', 'mount', 'unmount']
  const candidate = value as Record<string, unknown>
  return ['bootstrap', 'mount', 'unmount'].filter(name => !isLifecycle(candidate[name]))
}

export function isLegacyParcelConfig(value: unknown): value is LegacyParcelConfig {
  return missingParcelLifecycles(value).length === 0
}
