/**
 * The single-spa parcel lifecycle, driven by the shell.
 *
 * The existing loading shape is preserved exactly: the shell registers the
 * remote, loads `<name>/single-spa-app`, and mounts the module it gets back as
 * a parcel. This class is the part that drives the parcel — it hands the
 * lifecycle its props, waits on `mountPromise`, and calls `unmount()` — while
 * the surrounding host keeps owning retry, deadlines and diagnostics.
 *
 * Every collaborator is injected: the parcel factory, the config and the DOM
 * element. Nothing here imports single-spa or Angular, so the whole lifecycle
 * is exercised in tests with plain objects.
 */

import {
  createMfeError,
  SnapshotSource,
  toMfeError,
  type MfeError,
  type Unsubscribe,
} from '@company/mfe-core'

import type {
  LegacyParcel,
  LegacyParcelConfig,
  LegacyParcelProps,
  MountRootParcel,
} from './single-spa-contract.ts'

/**
 * `idle` covers both "never mounted" and "unmounted and remountable": a legacy
 * app that has been unmounted is in exactly the state it started in, which is
 * what makes a remount a plain second mount rather than a special case.
 */
export type LegacyParcelStatus =
  | 'idle'
  | 'mounting'
  | 'mounted'
  | 'unmounting'
  | 'error'
  | 'disposed'

export interface LegacyParcelMountOptions {
  /** The neutral definition id, used for diagnostics. */
  readonly id: string
  /** The legacy registry name, passed to the parcel as its activity name. */
  readonly containerName: string
  readonly parcelConfig: LegacyParcelConfig
  /** single-spa's `mountRootParcel`, or a double in tests. */
  readonly mountRootParcel: MountRootParcel
  /** The element the shell owns and the legacy app renders into. */
  readonly domElement: HTMLElement
  /** The resolved base href, when this app consumes one from the shell. */
  readonly baseHref?: string | undefined
  readonly version?: string | undefined
  /** Extra lifecycle props forwarded verbatim. */
  readonly props?: Readonly<Record<string, unknown>> | undefined
}

export class LegacyParcelMount {
  readonly id: string

  readonly #options: LegacyParcelMountOptions
  readonly #status = new SnapshotSource<LegacyParcelStatus>('idle')
  #parcel: LegacyParcel | null = null
  #error: MfeError | null = null
  #disposal: Promise<void> | null = null

  constructor(options: LegacyParcelMountOptions) {
    this.id = options.id
    this.#options = options
  }

  get status(): LegacyParcelStatus {
    return this.#status.getSnapshot()
  }

  /** Stable reference, so a host can subscribe without re-binding. */
  readonly getStatus = (): LegacyParcelStatus => this.#status.getSnapshot()

  readonly subscribe = (listener: () => void): Unsubscribe => this.#status.subscribe(listener)

  /** The last failure, kept so a host can render it after the status moved on. */
  get error(): MfeError | null {
    return this.#error
  }

  get isMounted(): boolean {
    return this.#status.getSnapshot() === 'mounted'
  }

  get isDisposed(): boolean {
    return this.#disposal !== null
  }

  /** The props the parcel lifecycle receives. Built once per mount. */
  #buildProps(): LegacyParcelProps {
    const { baseHref } = this.#options
    return {
      ...(this.#options.props ?? {}),
      domElement: this.#options.domElement,
      name: this.#options.containerName,
      ...(baseHref === undefined ? {} : { baseHref }),
    }
  }

  #fail(error: unknown, operation: string, repair: string): MfeError {
    const mfeError = toMfeError(error, {
      code: 'mount/failure',
      id: this.id,
      ...(this.#options.version === undefined ? {} : { definitionVersion: this.#options.version }),
      operation,
      declaredBy: 'The legacy parcel lifecycle',
      repair,
    })
    this.#error = mfeError
    return mfeError
  }

  /**
   * Bootstraps and mounts the parcel, resolving once single-spa reports the app
   * on screen. A second mount without an intervening unmount is a programming
   * error rather than a silent no-op: two live parcels would both render into
   * the same element.
   */
  async mount(): Promise<void> {
    if (this.isDisposed) {
      throw createMfeError({
        code: 'mount/failure',
        id: this.id,
        operation: 'mount the legacy parcel',
        expected: 'a live mount',
        observed: 'a disposed mount',
        declaredBy: 'The legacy parcel lifecycle',
        repair:
          'Create a new LegacyParcelMount instead of reusing a disposed one. Disposal is terminal.',
      })
    }

    const status = this.#status.getSnapshot()
    if (status === 'mounting' || status === 'mounted') {
      throw createMfeError({
        code: 'mount/failure',
        id: this.id,
        operation: 'mount the legacy parcel',
        expected: 'an unmounted parcel',
        observed: `a parcel that is already ${status}`,
        declaredBy: 'The legacy parcel lifecycle',
        repair:
          'Await unmount() before mounting again. Two parcels rendering into one element would leave orphaned DOM behind.',
      })
    }

    this.#error = null
    this.#status.set('mounting')

    let parcel: LegacyParcel
    try {
      parcel = this.#options.mountRootParcel(this.#options.parcelConfig, this.#buildProps())
    } catch (error) {
      this.#status.set('error')
      throw this.#fail(
        error,
        'create the legacy parcel',
        `Check that ${this.#options.containerName} still exposes a single-spa parcel with bootstrap, mount and unmount lifecycles.`,
      )
    }

    this.#parcel = parcel

    try {
      await parcel.mountPromise
    } catch (error) {
      this.#parcel = null
      this.#status.set('error')
      throw this.#fail(
        error,
        'mount the legacy parcel',
        `Check the browser console for the error ${this.#options.containerName} threw while bootstrapping. The shell kept the mount surface so a retry can reuse it.`,
      )
    }

    // Disposal or an explicit unmount can win the race with a slow bootstrap.
    // Either way the parcel this call created is already being torn down, so
    // the attempt must not report success or re-publish a stale reference.
    if (this.#parcel !== parcel) {
      throw createMfeError({
        code: 'mount/failure',
        id: this.id,
        operation: 'mount the legacy parcel',
        expected: 'a live mount when the parcel finished bootstrapping',
        observed: this.isDisposed
          ? 'a mount that was disposed while the parcel was still bootstrapping'
          : 'a mount that was unmounted while the parcel was still bootstrapping',
        declaredBy: 'The legacy parcel lifecycle',
        repair:
          'No action required when this follows a navigation away from the app. The parcel that superseded this attempt was already unmounted.',
      })
    }

    this.#status.set('mounted')
  }

  /**
   * Unmounts the parcel and returns the mount to `idle`, from which it can be
   * mounted again. Unmounting when nothing is mounted is a no-op, so a shell
   * does not have to track whether a failed mount left a parcel behind.
   */
  async unmount(): Promise<void> {
    const parcel = this.#parcel
    if (!parcel) return

    this.#parcel = null
    this.#status.set('unmounting')

    try {
      await parcel.unmount()
    } catch (error) {
      this.#status.set('error')
      const mfeError = toMfeError(error, {
        code: 'dispose/failure',
        id: this.id,
        ...(this.#options.version === undefined ? {} : { definitionVersion: this.#options.version }),
        operation: 'unmount the legacy parcel',
        declaredBy: 'The legacy parcel lifecycle',
        repair: `Check ${this.#options.containerName}'s ngOnDestroy for a throwing teardown. The shell has already dropped its reference to the parcel, so it will not be reused.`,
      })
      this.#error = mfeError
      throw mfeError
    }

    this.#status.set('idle')
  }

  /**
   * Terminal teardown. Idempotent in the sense the framework requires: every
   * caller awaits the same cleanup, and a second call never starts a second
   * teardown — including when the first one failed.
   */
  dispose(): Promise<void> {
    this.#disposal ??= this.#runDisposal()
    return this.#disposal
  }

  async #runDisposal(): Promise<void> {
    const parcel = this.#parcel
    this.#parcel = null

    try {
      if (parcel) await parcel.unmount()
    } catch (error) {
      const mfeError = toMfeError(error, {
        code: 'dispose/failure',
        id: this.id,
        ...(this.#options.version === undefined ? {} : { definitionVersion: this.#options.version }),
        operation: 'dispose the legacy parcel',
        declaredBy: 'The legacy parcel lifecycle',
        repair: `Check ${this.#options.containerName}'s teardown. The mount is disposed either way; it is never reused after a failed teardown.`,
      })
      this.#error = mfeError
      throw mfeError
    } finally {
      this.#status.set('disposed')
      this.#status.dispose()
    }
  }
}
