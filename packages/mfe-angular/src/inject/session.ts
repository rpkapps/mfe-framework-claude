/** A mount-owned security session, shared by every injected consumer in that application. */

import {
  DestroyRef,
  InjectionToken,
  inject,
  signal,
  type Provider,
  type Signal,
} from '@angular/core'

import { injectMfeMount } from './runtime.ts'

export interface MfeSession {
  readonly generation: number
  /** Aborts on identity/permission changes as well as mount disposal. */
  readonly signal: AbortSignal
}

export const MFE_SESSION = new InjectionToken<Signal<MfeSession>>('MFE_SESSION')

/** Internal mount provider; never installed in a shell application's root injector. */
export function provideSession(): Provider {
  return {
    provide: MFE_SESSION,
    useFactory: () => {
      const mount = injectMfeMount('injectSession()')
      let controller = new AbortController()
      let disposed = false
      const session = signal<MfeSession>({ generation: 0, signal: controller.signal })
      const unsubscribe = mount.runtime.shellState.observeTransitions(change => {
        if (disposed || mount.signal.aborted) return
        if (
          !change.transitions.some(
            transition => transition.kind === 'identity' || transition.kind === 'groups',
          )
        )
          return

        controller.abort()
        controller = new AbortController()
        session.set({ generation: session().generation + 1, signal: controller.signal })
      })
      const dispose = (): void => {
        disposed = true
        unsubscribe()
        controller.abort()
        mount.signal.removeEventListener('abort', dispose)
      }
      inject(DestroyRef).onDestroy(dispose)
      if (mount.signal.aborted) dispose()
      else mount.signal.addEventListener('abort', dispose, { once: true })
      return session.asReadonly()
    },
  }
}

/**
 * Widgets and services can reload user-dependent data when the generation changes. Retain the
 * signal for the session that started a request; do not read the next session's signal later.
 */
export function injectSession(): Signal<MfeSession> {
  injectMfeMount('injectSession()')
  return inject(MFE_SESSION)
}
