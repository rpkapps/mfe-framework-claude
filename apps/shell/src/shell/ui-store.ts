/**
 * Which shell surface is open.
 *
 * The header opens these, and so does the command palette — and a palette item
 * that opened a sheet by reaching for a callback the header happened to pass it
 * would make every new surface another prop threaded through the chrome. One
 * store instead: the chrome subscribes, anything may open.
 *
 * Module state rather than context, because there is exactly one shell per
 * document and nothing below the chrome may open a shell surface. Not a
 * component, so React Refresh can replace the panels that read it without
 * closing the one you are looking at.
 */

/** Every surface the shell owns. `null` is "the page itself". */
export type ShellSurface = 'palette' | 'registry' | 'settings' | 'help' | 'releases' | 'bug'

let open: ShellSurface | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

/*
 * Arrow properties rather than methods: `subscribe` and `getSnapshot` are
 * handed straight to `useSyncExternalStore`, which calls them detached from
 * this object.
 */
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
