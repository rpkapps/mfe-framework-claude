import { useMemo, useSyncExternalStore } from 'react'

import type {
  SharedStateInspection,
  SharedStateInspectionSnapshot,
} from '@company/mfe-core/shared-state'

const unavailable: SharedStateInspectionSnapshot = Object.freeze({
  generation: 0,
  disposed: false,
  entries: [],
})
const getUnavailable = (): SharedStateInspectionSnapshot => unavailable
const subscribeUnavailable = (): (() => void) => () => {}

/** The hook remains unconditional when a custom service has no inspection capability. */
export function useSharedStateInspection(
  inspection: SharedStateInspection | undefined,
): SharedStateInspectionSnapshot {
  const source = useMemo(
    () =>
      inspection === undefined
        ? {
            subscribe: subscribeUnavailable,
            getSnapshot: getUnavailable,
          }
        : {
            subscribe: (listener: () => void) => inspection.subscribe(listener),
            getSnapshot: () => inspection.getSnapshot(),
          },
    [inspection],
  )
  return useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot)
}
