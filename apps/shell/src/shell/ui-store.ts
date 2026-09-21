/**
 * Which shell surface is open, as one store so the palette can open a sheet without a callback
 * threaded through the chrome. Module state rather than context, because there is exactly one
 * shell per document.
 */

/** The registry is not one of these: it moved into the developer tools, behind their own flag (§22). */
export type ShellSurface = 'palette' | 'settings' | 'help' | 'releases' | 'bug'

let open: ShellSurface | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

/* Arrow properties rather than methods: `useSyncExternalStore` calls `subscribe` and `getSnapshot` detached from this object. */
export const shellUi = {
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },

  getSnapshot: (): ShellSurface | null => open,

  /** Opening one closes the other: these are all modal, and two is a stack. */
  show: (surface: ShellSurface): void => {
    if (open === surface) return
    open = surface
    emit()
  },

  close: (): void => {
    if (open === null) return
    open = null
    emit()
  },

  toggle: (surface: ShellSurface): void => {
    open = open === surface ? null : surface
    emit()
  },
}
