/**
 * The explicit shell-boundary navigation bridge and blocker negotiation.
 *
 * Nothing here reassigns a global History or event-listener method — *calling*
 * `pushState` is ordinary use of a browser API, *replacing* it is the patch this
 * replaced. Negotiation lives here because ordering across nested mounts is a
 * host concern: innermost first, stopping at the first refusal.
 */

import {
  createMfeError,
  toMfeError,
  type BoundaryLocation,
  type DiagnosticsHub,
  type NavigationAction,
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
  /**
   * Whether closing or reloading the tab should raise the browser's own
   * prompt. It is a separate question from `shouldBlock`: a reload is not a
   * navigation, there is no intent to inspect and nothing may be rendered, so
   * the only available answer is the browser's. Omitted means yes, which is
   * what TanStack's `enableBeforeUnload` defaults to.
   */
  shouldBlockUnload?(): boolean
}

export type NavigationOutcome = 'proceeded' | 'blocked'

export interface BoundaryNavigatorOptions {
  readonly bridge: NavigationBridge
  readonly diagnostics?: DiagnosticsHub
}

/** One registration: which mount it belongs to, and what it answers. */
interface BlockerEntry {
  readonly mountToken: string
  readonly blocker: NavigationBlocker
}

/** Coordinates blockers over one navigation bridge. */
export class BoundaryNavigator {
  readonly #bridge: NavigationBridge
  readonly #diagnostics: DiagnosticsHub | undefined
  /*
   * A set of registrations rather than a map keyed by mount token: one mount
   * can have more than one thing to lose. The framework registers the App's
   * router blockers on the mount's behalf, and an author may register another
   * for a Widget or a non-routed editor in the same mount — keying by the token
   * made the second registration silently delete the first.
   */
  readonly #blockers = new Set<BlockerEntry>()
  /*
   * Listeners that heard an external navigation while one was being negotiated.
   * A browser back moves the URL before anyone is asked, so a mount told about
   * it straight away would leave the page the user is still being asked about.
   */
  readonly #deferred = new Set<(location: BoundaryLocation) => void>()
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
    const entry: BlockerEntry = { mountToken, blocker }
    this.#blockers.add(entry)
    return () => {
      this.#blockers.delete(entry)
    }
  }

  /** Removes every blocker a mount registered, as part of disposal. */
  removeMount(mountToken: string): void {
    for (const entry of [...this.#blockers]) {
      if (entry.mountToken === mountToken) this.#blockers.delete(entry)
    }
  }

  /**
   * Whether anything registered wants the browser's unload prompt. A host asks
   * this from its own `beforeunload`, which is the one navigation no mount can
   * negotiate: the answer has to be synchronous and the browser draws the UI.
   */
  wantsUnloadPrompt(): boolean {
    for (const { blocker } of this.#blockers) {
      if (this.#safeShouldBlockUnload(blocker)) return true
    }
    return false
  }

  read(): BoundaryLocation {
    return this.#bridge.read()
  }

  /**
   * The opaque state stored with the current entry.
   *
   * Delegated rather than omitted, because the navigator is itself the bridge a
   * mount's boundary history is built over. A navigator that did not forward it
   * left every entry an App pushed with no state at all: the position
   * bookkeeping both histories keep there was lost, back and forward could not
   * be told apart, and a refused back navigation had no delta to roll back by.
   */
  readState(): unknown {
    return this.#bridge.readState?.()
  }

  /**
   * Navigations this host did not perform — browser back and forward.
   *
   * Held while a negotiation is under way, and released only if it proceeded.
   * A refusal is followed by the host restoring the URL, which arrives as
   * another event of its own; there is nothing to report about a navigation
   * that did not happen.
   *
   * The microtask is what makes this independent of the order the host's own
   * popstate listener and this one were registered in. The host starts its
   * negotiation synchronously from that event, so by the next microtask the
   * answer to "is one under way" is settled either way.
   */
  subscribe(listener: (location: BoundaryLocation) => void): Unsubscribe {
    let live = true

    const unsubscribe = this.#bridge.subscribe(() => {
      queueMicrotask(() => {
        if (!live) return
        if (this.#negotiating) this.#deferred.add(listener)
        else listener(this.#bridge.read())
      })
    })

    return () => {
      live = false
      this.#deferred.delete(listener)
      unsubscribe()
    }
  }

  /**
   * Asks every affected mount, innermost first, and commits once if they agree.
   * The commit happens after negotiation finishes rather than from inside it,
   * so a proceed cannot re-enter the same blockers through the bridge.
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

    const blocking = [...this.#blockers]
      .map(entry => entry.blocker)
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
        if (decision === 'reset') {
          this.#releaseDeferred('blocked')
          return 'blocked'
        }
      }
    } finally {
      this.#negotiating = false
    }

    commit()
    this.#releaseDeferred('proceeded')
    return 'proceeded'
  }

  /**
   * Hands on, or discards, whatever arrived mid-negotiation. Read fresh rather
   * than replayed: what a mount needs is where the page ended up, not the
   * location as it was when the question was asked.
   */
  #releaseDeferred(outcome: NavigationOutcome): void {
    if (this.#deferred.size === 0) return
    const listeners = [...this.#deferred]
    this.#deferred.clear()
    if (outcome === 'blocked') return

    const location = this.#bridge.read()
    for (const listener of listeners) listener(location)
  }

  push(to: string, state?: unknown): void {
    this.#bridge.push(to, state)
  }

  replace(to: string, state?: unknown): void {
    this.#bridge.replace(to, state)
  }

  back(): void {
    this.#bridge.back()
  }

  forward(): void {
    this.#bridge.forward()
  }

  /**
   * Relative traversal, falling back to a single step when the bridge has no
   * `go`. Doing nothing for a larger jump would strand a router mid-rollback.
   */
  go(delta: number): void {
    if (this.#bridge.go) {
      this.#bridge.go(delta)
      return
    }
    if (delta < 0) this.#bridge.back()
    else if (delta > 0) this.#bridge.forward()
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
    // Nothing is going to answer for these now, and a mount left waiting on a
    // navigation that will never settle never hears about the URL again.
    this.#releaseDeferred('proceeded')
  }

  #reportBlockerFailure(error: unknown, operation: string, repair: string): void {
    this.#diagnostics?.report(
      toMfeError(error, {
        code: 'app/invalid-router',
        id: 'navigation',
        operation,
        declaredBy: 'The blocking MFE',
        repair,
      }),
    )
  }

  #safeShouldBlockUnload(blocker: NavigationBlocker): boolean {
    try {
      // Unstated is yes: a blocker that has not thought about the reload case
      // is treated the way TanStack treats one, rather than losing the prompt.
      return blocker.shouldBlockUnload?.() ?? true
    } catch (error) {
      this.#reportBlockerFailure(
        error,
        'evaluate a navigation blocker for unload',
        'shouldBlockUnload must be a synchronous read of the MFE’s own state. The browser prompt was offered anyway, because losing it silently discards work.',
      )
      return true
    }
  }

  #safeShouldBlock(blocker: NavigationBlocker, intent: NavigationIntent): boolean {
    try {
      return blocker.shouldBlock(intent)
    } catch (error) {
      this.#reportBlockerFailure(
        error,
        'evaluate a navigation blocker',
        'shouldBlockFn must be a synchronous read of the MFE’s own state. The navigation was allowed to proceed because the check could not be trusted.',
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
      this.#reportBlockerFailure(
        error,
        'resolve a navigation blocker',
        'The confirmation UI threw, so the navigation was cancelled to avoid discarding unsaved work. Fix the resolver and try again.',
      )
      return 'reset'
    }
  }
}

/**
 * A bridge over the real browser History API: it calls `pushState`/`replaceState`
 * and listens for `popstate`, never reassigns them, never wraps
 * `addEventListener` and never emits synthetic `popstate` events.
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
  action?: NavigationAction,
): NavigationIntent {
  const normalized = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath
  const withinBoundary =
    normalized === '' || to.pathname === normalized || to.pathname.startsWith(`${normalized}/`)

  return {
    from,
    to,
    leavesBoundary: !withinBoundary,
    ...(action === undefined ? {} : { action }),
  }
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
 * An in-memory bridge for tests and non-browser hosts. It keeps its own entry
 * list, so back and forward behave like a browser without touching one.
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
