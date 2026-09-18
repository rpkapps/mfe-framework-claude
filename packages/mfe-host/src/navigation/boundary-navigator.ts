/**
 * The explicit shell-boundary navigation bridge and blocker negotiation.
 *
 * This replaces the global History patch the old shell used. The distinction
 * that matters: *calling* `history.pushState` is ordinary use of a browser API,
 * while *replacing* `history.pushState` is the patch that was removed. Nothing
 * here reassigns a global method or a global event-listener method, and the
 * shell router is never handed to remote code.
 *
 * Blocker negotiation lives here rather than in the adapter because ordering
 * across nested mounts is a host concern: evaluation runs innermost first,
 * stops at the first refusal, and never lets two confirmation flows run for one
 * navigation.
 */

import {
  createMfeError,
  toMfeError,
  type BoundaryLocation,
  type DiagnosticsHub,
  type NavigationBridge,
  type NavigationIntent,
  type Unsubscribe,
} from '@company/mfe-core'

/**
 * How one mount participates in a navigation it would lose. The MFE decides
 * whether to block and owns whatever UI it shows; the host only asks.
 */
export interface NavigationBlocker {
  /** Depth in the mount tree. Higher is more deeply nested, and asked first. */
  readonly depth: number
  /** A synchronous read of whether this mount currently wants to block. */
  shouldBlock(intent: NavigationIntent): boolean
  /**
   * Presents the mount's own confirmation UI and resolves once the user
   * decides. The mount stays mounted throughout, so its UI remains usable.
   */
  confirm(intent: NavigationIntent): Promise<'proceed' | 'reset'>
}

export type NavigationOutcome = 'proceeded' | 'blocked'

export interface BoundaryNavigatorOptions {
  readonly bridge: NavigationBridge
  readonly diagnostics?: DiagnosticsHub
}

/**
 * Coordinates blockers over one navigation bridge.
 *
 * A navigation already negotiating is not re-negotiated: a second request while
 * a confirmation is open is refused rather than opening a competing dialog.
 */
export class BoundaryNavigator {
  readonly #bridge: NavigationBridge
  readonly #diagnostics: DiagnosticsHub | undefined
  readonly #blockers = new Map<string, NavigationBlocker>()
  #negotiating = false

  constructor(options: BoundaryNavigatorOptions) {
    this.#bridge = options.bridge
    this.#diagnostics = options.diagnostics
  }

  get blockerCount(): number {
    return this.#blockers.size
  }

  get isNegotiating(): boolean {
    return this.#negotiating
  }

  registerBlocker(mountToken: string, blocker: NavigationBlocker): Unsubscribe {
    this.#blockers.set(mountToken, blocker)
    return () => {
      this.#blockers.delete(mountToken)
    }
  }

  /** Removes a mount's blocker as part of disposal. */
  removeMount(mountToken: string): void {
    this.#blockers.delete(mountToken)
  }

  read(): BoundaryLocation {
    return this.#bridge.read()
  }

  subscribe(listener: (location: BoundaryLocation) => void): Unsubscribe {
    return this.#bridge.subscribe(listener)
  }

  /**
   * Asks every affected mount, innermost first, and commits the transition once
   * if they all agree.
   *
   * A proceed commits exactly once and does not re-enter the same blockers
   * through the bridge, because the commit happens after negotiation has
   * finished rather than from inside it.
   */
  async requestNavigation(
    intent: NavigationIntent,
    commit: () => void,
  ): Promise<NavigationOutcome> {
    if (this.#negotiating) {
      // A second confirmation flow for one navigation would let a user answer
      // two dialogs for one intent, so the later request is refused outright.
      return 'blocked'
    }

    const blocking = [...this.#blockers.values()]
      .filter(blocker => this.#safeShouldBlock(blocker, intent))
      .sort((a, b) => b.depth - a.depth)

    if (blocking.length === 0) {
      commit()
      return 'proceeded'
    }

    this.#negotiating = true
    try {
      for (const blocker of blocking) {
        const decision = await this.#safeConfirm(blocker, intent)
        // Stop at the first refusal: the current UI and route stay intact and
        // the remaining mounts are never asked.
        if (decision === 'reset') return 'blocked'
      }
    } finally {
      this.#negotiating = false
    }

    commit()
    return 'proceeded'
  }

  push(to: string): void {
    this.#bridge.push(to)
  }

  replace(to: string): void {
    this.#bridge.replace(to)
  }

  back(): void {
    this.#bridge.back()
  }

  forward(): void {
    this.#bridge.forward()
  }

  reload(): void {
    this.#bridge.reload()
  }

  /**
   * Forced cleanup after session revocation, failure or explicit host disposal
   * is not a user navigation transaction and cannot be vetoed.
   */
  clearBlockers(): void {
    this.#blockers.clear()
    this.#negotiating = false
  }

  #safeShouldBlock(blocker: NavigationBlocker, intent: NavigationIntent): boolean {
    try {
      return blocker.shouldBlock(intent)
    } catch (error) {
      this.#diagnostics?.report(
        toMfeError(error, {
          code: 'app/invalid-router',
          id: 'navigation',
          operation: 'evaluate a navigation blocker',
          declaredBy: 'The blocking MFE',
          repair:
            'shouldBlockFn must be a synchronous read of the MFE’s own state. The navigation was allowed to proceed because the check could not be trusted.',
        }),
      )
      return false
    }
  }

  async #safeConfirm(
    blocker: NavigationBlocker,
    intent: NavigationIntent,
  ): Promise<'proceed' | 'reset'> {
    try {
      return await blocker.confirm(intent)
    } catch (error) {
      this.#diagnostics?.report(
        toMfeError(error, {
          code: 'app/invalid-router',
          id: 'navigation',
          operation: 'resolve a navigation blocker',
          declaredBy: 'The blocking MFE',
          repair:
            'The confirmation UI threw, so the navigation was cancelled to avoid discarding unsaved work. Fix the resolver and try again.',
        }),
      )
      return 'reset'
    }
  }
}

/**
 * A bridge over the real browser History API.
 *
 * It calls `pushState`/`replaceState` and listens for `popstate`. It never
 * reassigns them, never wraps `addEventListener`, and never emits synthetic
 * `popstate` events to keep two routers in sync.
 */
export function createBrowserNavigationBridge(target: Window = window): NavigationBridge {
  const read = (): BoundaryLocation => ({
    pathname: target.location.pathname,
    search: target.location.search,
    hash: target.location.hash,
  })

  return {
    read,

    readState: () => {
      // `History.state` is `any`; the bridge contract hands back `unknown` so a
      // caller has to narrow it before reading anything off it.
      const state: unknown = target.history.state
      return state
    },

    subscribe: listener => {
      const onPopState = (): void => listener(read())
      target.addEventListener('popstate', onPopState)
      return () => target.removeEventListener('popstate', onPopState)
    },

    push: (to, state) => {
      target.history.pushState(state ?? null, '', to)
    },

    replace: (to, state) => {
      target.history.replaceState(state ?? null, '', to)
    },

    back: () => target.history.back(),
    forward: () => target.history.forward(),
    go: delta => target.history.go(delta),
    reload: () => target.location.reload(),
  }
}

/** Builds an intent, deciding whether the transition leaves the boundary. */
export function createNavigationIntent(
  from: BoundaryLocation,
  to: BoundaryLocation,
  basePath: string,
): NavigationIntent {
  const normalized = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath
  const withinBoundary =
    normalized === '' || to.pathname === normalized || to.pathname.startsWith(`${normalized}/`)

  return { from, to, leavesBoundary: !withinBoundary }
}

/** Parses a URL string into a boundary location without touching the document. */
export function parseBoundaryLocation(
  url: string,
  base = 'http://boundary.invalid',
): BoundaryLocation {
  try {
    const parsed = new URL(url, base)
    return { pathname: parsed.pathname, search: parsed.search, hash: parsed.hash }
  } catch (error) {
    throw createMfeError({
      code: 'app/invalid-base-path',
      id: 'navigation',
      operation: 'parse a navigation target',
      expected: 'a path or absolute URL',
      observed: JSON.stringify(url),
      declaredBy: 'The navigation bridge',
      repair: 'Pass a path such as "/reports/42" or a fully qualified URL.',
      cause: error,
    })
  }
}

/**
 * An in-memory bridge for tests and for non-browser hosts.
 *
 * Route tests use this instead of a global History patch: it keeps its own
 * entry list, so back and forward behave like a browser without touching one.
 */
export function createMemoryNavigationBridge(
  initialEntries: readonly string[] = ['/'],
): NavigationBridge & { readonly entries: readonly string[] } {
  const entries: { location: BoundaryLocation; state: unknown }[] = (
    initialEntries.length > 0 ? initialEntries : ['/']
  ).map((entry, position) => ({
    location: parseBoundaryLocation(entry),
    state: { __TSR_index: position },
  }))

  let cursor = entries.length - 1
  const listeners = new Set<(location: BoundaryLocation) => void>()

  const currentEntry = (): { location: BoundaryLocation; state: unknown } => {
    const entry = entries[cursor]
    if (!entry) throw new Error('Memory navigation bridge has no current entry')
    return entry
  }

  const notify = (): void => {
    const { location } = currentEntry()
    for (const listener of [...listeners]) listener(location)
  }

  return {
    get entries() {
      return entries.map(entry => `${entry.location.pathname}${entry.location.search}`)
    },

    read: () => currentEntry().location,
    readState: () => currentEntry().state,

    subscribe: listener => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    push: (to, state) => {
      entries.splice(cursor + 1)
      entries.push({ location: parseBoundaryLocation(to), state })
      cursor = entries.length - 1
    },

    replace: (to, state) => {
      entries[cursor] = { location: parseBoundaryLocation(to), state }
    },

    back: () => {
      if (cursor === 0) return
      cursor -= 1
      notify()
    },

    forward: () => {
      if (cursor >= entries.length - 1) return
      cursor += 1
      notify()
    },

    go: delta => {
      const next = Math.min(Math.max(cursor + delta, 0), entries.length - 1)
      if (next === cursor) return
      cursor = next
      notify()
    },

    reload: () => notify(),
  }
}
