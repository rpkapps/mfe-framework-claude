/**
 * The one mount an Angular host component owns at a time. The runtime decides everything about
 * the mount itself; what is left for the component is its status as a signal, each failure once,
 * and replacing or releasing the mount when its inputs or its own life say so.
 */

import { computed, signal, type Signal } from '@angular/core'
import type { MfeError, MountState, Unsubscribe } from '@company/mfe-core'
import type { DefinitionMount, WidgetDefinitionMount, WidgetInputState } from '@company/mfe-runtime'

/** Where the hosted mount is; `pending` covers loading and mounting alike. */
export type MountStatus = MountState['status']

export class HostedMount<M extends DefinitionMount> {
  readonly #state = signal<MountState>({ status: 'pending', attempt: 0 })
  readonly state = this.#state.asReadonly()
  readonly #attempt = signal(0)
  readonly attempt = this.#attempt.asReadonly()
  readonly status: Signal<MountStatus> = computed(() => this.#state().status)
  readonly error = computed(() => {
    const state = this.#state()
    return state.status === 'error' ? state.error : null
  })
  readonly #inputState = signal<WidgetInputState>({ status: 'accepted' })
  readonly inputState = this.#inputState.asReadonly()
  readonly inputStatus = computed(() => this.#inputState().status)
  readonly inputError = computed(() => {
    const state = this.#inputState()
    return state.status === 'rejected' ? state.error : null
  })
  readonly #onError: (error: MfeError) => void
  #mount: M | null = null
  #unsubscribe: Unsubscribe | null = null
  #unsubscribeInput: Unsubscribe | null = null

  constructor(onError: (error: MfeError) => void) {
    this.#onError = onError
  }

  get current(): M | null {
    return this.#mount
  }

  /** A placement error before a runtime mount exists is still shown in this host's region. */
  fail(error: MfeError): void {
    this.release()
    this.#attempt.set(0)
    this.#state.set({ status: 'error', error })
    this.#onError(error)
  }

  /** Releases whatever was hosted, then follows `mount`. */
  replace(mount: M): void {
    this.release()
    this.#mount = mount
    this.#state.set(mount.getState())
    this.#attempt.set(mount.attempt)
    this.#unsubscribe = mount.subscribe(() => {
      const state = mount.getState()
      this.#state.set(state)
      this.#attempt.set(mount.attempt)
      if (state.status === 'error') this.#onError(state.error)
    })
    if (isWidgetMount(mount)) {
      this.#inputState.set(mount.getInputState())
      this.#unsubscribeInput = mount.subscribeInput(() => {
        this.#inputState.set(mount.getInputState())
      })
    }
  }

  /** Stops following before disposing, so a released mount's disposal is not reported as news. */
  release(): void {
    this.#unsubscribe?.()
    this.#unsubscribe = null
    this.#unsubscribeInput?.()
    this.#unsubscribeInput = null
    this.#inputState.set({ status: 'accepted' })
    const mount = this.#mount
    this.#mount = null
    // A cleanup failure has already reached the runtime's diagnostics; nobody here can act on it.
    void mount?.dispose().catch(() => undefined)
  }
}

function isWidgetMount(mount: DefinitionMount): mount is WidgetDefinitionMount {
  return typeof (mount as Partial<WidgetDefinitionMount>).getInputState === 'function'
}
