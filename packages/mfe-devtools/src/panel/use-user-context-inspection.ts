import { useMemo, useSyncExternalStore } from 'react'

import type {
  UserContextInspection,
  UserContextInspectionSnapshot,
} from '@company/mfe-core/user-context'

const unavailable: UserContextInspectionSnapshot = Object.freeze({
  generation: 0,
  disposed: false,
  entries: [],
})
const getUnavailable = (): UserContextInspectionSnapshot => unavailable
const subscribeUnavailable = (): (() => void) => () => {}

/** The hook remains unconditional when a custom service has no inspection capability. */
export function useUserContextInspection(
  inspection: UserContextInspection | undefined,
): UserContextInspectionSnapshot {
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
