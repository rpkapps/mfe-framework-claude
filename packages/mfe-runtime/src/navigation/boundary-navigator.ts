/**
 * The explicit shell-boundary navigation bridge and blocker negotiation. Nothing here
 * reassigns a global History or event-listener method (§1), and negotiation lives here
 * because ordering across nested mounts is a host concern.
 */

import {
  createMfeError,
  isWithinBoundary,
  toMfeError,
  type BoundaryLocation,
  type NavigationAction,
  type NavigationBridge,
  type NavigationIntent,
  type Unsubscribe,
} from '@company/mfe-core'

import type { DiagnosticsHub } from '../diagnostics.ts'

/** The MFE owns the decision and whatever UI it shows; the host only asks. */
export interface NavigationBlocker {
  /** Higher is more deeply nested, and asked first. */
  readonly depth: number
  shouldBlock(intent: NavigationIntent): boolean
  /** The mount stays mounted while its own confirmation UI is up, so that UI remains usable. */
  confirm(intent: NavigationIntent): Promise<'proceed' | 'reset'>
  /**
   * A reload is not a navigation, so the browser's prompt is a separate synchronous
   * question rather than a count of registrations (§20); omitted means yes, which is what
   * TanStack's `enableBeforeUnload` defaults to.
   */
  shouldBlockUnload?(): boolean
}

export type NavigationOutcome = 'proceeded' | 'blocked'

export interface BoundaryNavigatorOptions {
  readonly bridge: NavigationBridge
  readonly diagnostics?: DiagnosticsHub
}

interface BlockerEntry {
  readonly mountToken: string
  readonly blocker: NavigationBlocker
}

export class BoundaryNavigator {
  readonly #bridge: NavigationBridge
  readonly #diagnostics: DiagnosticsHub | undefined
  // One mount can have more than one thing to lose, so keying by mount token would let a
  // second registration silently delete the first.
  readonly #blockers = new Set<BlockerEntry>()
  // A browser back moves the URL before anyone is asked, so a mount told about it straight
  // away would leave the page the user is still being asked about (§20).
  readonly #deferred = new Set<(location: BoundaryLocation) => void>()
  readonly #listeners = new Set<(location: BoundaryLocation) => void>()
  /**
   * Where subscribers were last told the page is, or where a push through this navigator took
   * it, which the mount that pushed already knows. `announce` measures a change against it.
   */
  #known: BoundaryLocation
  #negotiating = false

  constructor(options: BoundaryNavigatorOptions) {
    this.#bridge = options.bridge
    this.#diagnostics = options.diagnostics
    this.#known = options.bridge.read()
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

  removeMount(mountToken: string): void {
    for (const entry of [...this.#blockers]) {
      if (entry.mountToken === mountToken) this.#blockers.delete(entry)
    }
  }

  /** A host asks this from its own `beforeunload`, where the answer has to be synchronous. */
  wantsUnloadPrompt(): boolean {
    for (const { blocker } of this.#blockers) {
      if (this.#safeShouldBlockUnload(blocker)) return true
    }
    return false
  }

  read(): BoundaryLocation {
    return this.#bridge.read()
  }

  /** Without it an App's entries carry no state, so no history can compute a delta (§1). */
  readState(): unknown {
    return this.#bridge.readState?.()
  }

  /**
   * Navigations this host did not perform, held while a negotiation is under way and
   * released only if it proceeded (§20). The microtask is what makes that independent of
   * the order the host's own popstate listener and this one were registered in.
   */
  subscribe(listener: (location: BoundaryLocation) => void): Unsubscribe {
    let live = true
    this.#listeners.add(listener)

    const unsubscribe = this.#bridge.subscribe(() => {
      queueMicrotask(() => {
        if (!live) return
        if (this.#negotiating) this.#deferred.add(listener)
        else this.#emit([listener], this.#bridge.read())
      })
    })

    return () => {
      live = false
      this.#listeners.delete(listener)
      this.#deferred.delete(listener)
      unsubscribe()
    }
  }

  /**
   * Tells every subscriber where the page is after a navigation the host performed with its own
   * router. A bridge reports only navigations nobody on the page initiated — the browser bridge
   * hears `popstate` alone — so without this a mounted App would stay where it was while the URL
   * moved. Nothing is emitted when the page is where subscribers already know it to be, so a
   * host can announce every change of its own router without repeating what the bridge
   * delivered. Held like a bridge report while a negotiation is under way.
   */
  announce(): void {
    const location = this.#bridge.read()
    if (sameLocation(location, this.#known)) return

    if (this.#negotiating) {
      for (const listener of this.#listeners) this.#deferred.add(listener)
      return
    }
    this.#emit([...this.#listeners], location)
  }

  #emit(
    listeners: readonly ((location: BoundaryLocation) => void)[],
    location: BoundaryLocation,
  ): void {
    this.#known = location
    for (const listener of listeners) listener(location)
  }

  /**
   * Asks every affected mount, innermost first, and commits after the negotiation finishes
   * rather than from inside it, so a proceed cannot re-enter the same blockers.
   */
  async requestNavigation(
    intent: NavigationIntent,
    commit: () => void,
  ): Promise<NavigationOutcome> {
    if (this.#negotiating) {
      // A second flow for one navigation would let a user answer two dialogs for one
      // intent, so the later request is refused outright.
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

  /** Read fresh rather than replayed: a mount needs where the page ended up, not where it was. */
  #releaseDeferred(outcome: NavigationOutcome): void {
    if (this.#deferred.size === 0) return
    const listeners = [...this.#deferred]
    this.#deferred.clear()
    if (outcome === 'blocked') return

    this.#emit(listeners, this.#bridge.read())
  }

  push(to: string, state?: unknown): void {
    this.#bridge.push(to, state)
    this.#known = this.#bridge.read()
  }

  replace(to: string, state?: unknown): void {
    this.#bridge.replace(to, state)
    this.#known = this.#bridge.read()
  }

  back(): void {
    this.#bridge.back()
  }

  forward(): void {
    this.#bridge.forward()
  }

  /** A bridge with no `go` falls back to one step; doing nothing would strand a rollback. */
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

  /** Forced cleanup is not a user navigation transaction, so it cannot be vetoed. */
  clearBlockers(): void {
    this.#blockers.clear()
    this.#negotiating = false
    // Nothing will answer for these now, and a mount left waiting on a negotiation that
    // never settles never hears about the URL again.
    this.#releaseDeferred('proceeded')
  }

  #reportBlockerFailure(error: unknown, operation: string, repair: string): void {
    this.#diagnostics?.report(
      toMfeError(error, {
        code: 'app/invalid-router',
        id: 'navigation',
        operation,
        repair,
      }),
    )
  }

  #safeShouldBlockUnload(blocker: NavigationBlocker): boolean {
    try {
      // Unstated is yes: a blocker that has not thought about the reload case is treated
      // the way TanStack treats one, rather than losing the prompt.
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
 * A bridge over the real browser History API: it calls `pushState`/`replaceState` and
 * listens for `popstate`, never reassigns them and never emits a synthetic one (§1).
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
      // `History.state` is `any`; the bridge contract hands back `unknown` so a caller has
      // to narrow it before reading anything off it.
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

function sameLocation(a: BoundaryLocation, b: BoundaryLocation): boolean {
  return a.pathname === b.pathname && a.search === b.search && a.hash === b.hash
}

export function createNavigationIntent(
  from: BoundaryLocation,
  to: BoundaryLocation,
  basePath: string,
  action?: NavigationAction,
): NavigationIntent {
  return {
    from,
    to,
    leavesBoundary: !isWithinBoundary(basePath, to.pathname),
    ...(action === undefined ? {} : { action }),
  }
}

/**
 * Which definition owns the boundary a path falls inside, or `undefined` for the host's
 * own page; a host places each App at `/<id>`, so this is the one derivation rather than
 * several that can disagree (§26). The segment is returned whatever it says, because a
 * path naming something the registry never heard of is a real state a host has to render.
 */
export function boundaryDefinitionId(url: string): string | undefined {
  const [first] = parseBoundaryLocation(url)
    .pathname.split('/')
    .filter(segment => segment !== '')
  return first
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
      repair: 'Pass a path such as "/reports/42" or a fully qualified URL.',
      cause: error,
    })
  }
}
