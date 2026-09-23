/**
 * Exposing a neutral store as a signal. Every store the runtime owns hands out referentially
 * stable snapshots, so the signal's own equality check is all the change detection needed: an
 * unchanged snapshot notifies nobody, and no selector cache is required on top.
 */

import { DestroyRef, inject, signal, type Signal } from '@angular/core'
import type { Unsubscribe } from '@company/mfe-core'

/** Subscribes for as long as the injection context lives; call it in a field initialiser. */
export function signalFromStore<T>(
  subscribe: (listener: () => void) => Unsubscribe,
  getSnapshot: () => T,
): Signal<T> {
  const value = signal(getSnapshot())
  const unsubscribe = subscribe(() => {
    value.set(getSnapshot())
  })
  inject(DestroyRef).onDestroy(unsubscribe)
  return value.asReadonly()
}
