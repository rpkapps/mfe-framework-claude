/**
 * The one mount an Angular host component owns at a time. The runtime decides everything about
 * the mount itself; what is left for the component is its status as a signal, each failure once,
 * and replacing or releasing the mount when its inputs or its own life say so.
 */

import { signal, type Signal } from '@angular/core'
import type { MfeError, MountState, Unsubscribe } from '@company/mfe-core'
import type { DefinitionMount } from '@company/mfe-runtime'

/** Where the hosted mount is; `pending` covers loading and mounting alike. */
export type MountStatus = MountState['status']

export class HostedMount<M extends DefinitionMount> {
  readonly #status = signal<MountStatus>('pending')
  readonly status: Signal<MountStatus> = this.#status.asReadonly()
  readonly #onError: (error: MfeError) => void
  #mount: M | null = null
  #unsubscribe: Unsubscribe | null = null

  constructor(onError: (error: MfeError) => void) {
    this.#onError = onError
  }

  get current(): M | null {
    return this.#mount
  }

  /** Releases whatever was hosted, then follows `mount`. */
  replace(mount: M): void {
    this.release()
    this.#mount = mount
    this.#status.set(mount.getState().status)
    this.#unsubscribe = mount.subscribe(() => {
      const state = mount.getState()
      this.#status.set(state.status)
      if (state.status === 'error') this.#onError(state.error)
    })
  }

  /** Stops following before disposing, so a released mount's disposal is not reported as news. */
  release(): void {
    this.#unsubscribe?.()
    this.#unsubscribe = null
    const mount = this.#mount
    this.#mount = null
    // A cleanup failure has already reached the runtime's diagnostics; nobody here can act on it.
    void mount?.dispose().catch(() => undefined)
  }
}
