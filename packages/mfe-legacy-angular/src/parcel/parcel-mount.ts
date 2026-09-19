/**
 * The single-spa parcel lifecycle, driven by the shell: hand the lifecycle its
 * props, wait on `mountPromise`, call `unmount()`. Retry, deadlines and
 * diagnostics stay with the host. Every collaborator is injected, so the whole
 * lifecycle is exercised in tests with plain objects.
 */

import {
  createMfeError,
  SnapshotSource,
  toMfeError,
  type MfeError,
  type Unsubscribe,
} from '@company/mfe-core'

import type { LegacyParcel, LegacyParcelConfig, MountRootParcel } from './single-spa-contract.ts'

/**
 * `idle` covers both "never mounted" and "unmounted and remountable": a legacy
 * app that has been unmounted is in exactly the state it started in, which is
 * what makes a remount a plain second mount rather than a special case.
 */
export type LegacyParcelStatus =
  'idle' | 'mounting' | 'mounted' | 'unmounting' | 'error' | 'disposed'

export interface LegacyParcelMountOptions {
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

  #refuse(observed: string, expected: string, repair: string): MfeError {
    return createMfeError({
      code: 'mount/failure',
      id: this.id,
      operation: 'mount the legacy parcel',
      expected,
      observed,
      repair,
    })
  }

  /** Records a collaborator failure so `error` survives the status change. */
  #report(
    error: unknown,
    code: 'mount/failure' | 'dispose/failure',
    operation: string,
    repair: string,
  ): MfeError {
    const mfeError = toMfeError(error, {
      code,
      id: this.id,
      ...(this.#options.version === undefined ? {} : { definitionVersion: this.#options.version }),
      operation,
      repair,
    })
    this.#error = mfeError
    return mfeError
  }

  /**
   * Bootstraps and mounts the parcel, resolving once single-spa reports the app
   * on screen. A second mount without an intervening unmount is refused: two
   * live parcels would both render into the same element.
   */
  async mount(): Promise<void> {
    if (this.isDisposed) {
      throw this.#refuse(
        'a disposed mount',
        'a live mount',
        'Create a new LegacyParcelMount. Disposal is terminal.',
      )
    }

    const status = this.#status.getSnapshot()
    if (status === 'mounting' || status === 'mounted') {
      throw this.#refuse(
        `a parcel that is already ${status}`,
        'an unmounted parcel',
        'Await unmount() before mounting again.',
      )
    }

    this.#error = null
    this.#status.set('mounting')

    const { containerName } = this.#options
    let parcel: LegacyParcel
    try {
      parcel = this.#options.mountRootParcel(this.#options.parcelConfig, {
        ...(this.#options.props ?? {}),
        domElement: this.#options.domElement,
        name: containerName,
        ...(this.#options.baseHref === undefined ? {} : { baseHref: this.#options.baseHref }),
      })
    } catch (error) {
      this.#status.set('error')
      throw this.#report(
        error,
        'mount/failure',
        'create the legacy parcel',
        `Check that ${containerName} still exposes a single-spa parcel.`,
      )
    }

    this.#parcel = parcel

    try {
      await parcel.mountPromise
    } catch (error) {
      this.#parcel = null
      this.#status.set('error')
      throw this.#report(
        error,
        'mount/failure',
        'mount the legacy parcel',
        `Check the browser console for the error ${containerName} threw while bootstrapping.`,
      )
    }

    // Disposal or an explicit unmount can win the race with a slow bootstrap.
    // Either way the parcel this call created is already being torn down, so
    // the attempt must not report success or re-publish a stale reference.
    if (this.#parcel !== parcel) {
      throw this.#refuse(
        this.isDisposed
          ? 'a mount that was disposed while the parcel was still bootstrapping'
          : 'a mount that was unmounted while the parcel was still bootstrapping',
        'a live mount when the parcel finished bootstrapping',
        'No action required when this follows a navigation away from the app.',
      )
    }

    this.#status.set('mounted')
  }

  /**
   * Unmounts and returns the mount to `idle`, from which it can be mounted
   * again. Unmounting when nothing is mounted is a no-op, so a shell does not
   * have to track whether a failed mount left a parcel behind.
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
      throw this.#report(
        error,
        'dispose/failure',
        'unmount the legacy parcel',
        `Check ${this.#options.containerName}'s ngOnDestroy for a throwing teardown. The parcel is never reused.`,
      )
    }

    this.#status.set('idle')
  }

  /**
   * Terminal teardown. Every caller awaits the same cleanup and a second call
   * never starts a second teardown, including when the first one failed.
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
      throw this.#report(
        error,
        'dispose/failure',
        'dispose the legacy parcel',
        `Check ${this.#options.containerName}'s teardown. The mount is disposed either way.`,
      )
    } finally {
      this.#status.set('disposed')
      this.#status.dispose()
    }
  }
}
