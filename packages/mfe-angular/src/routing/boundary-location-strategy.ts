/**
 * The App's location strategy, one per mount, built over the host's navigation bridge instead of
 * the browser's history, which `PathLocationStrategy` writes. The router never learns there is a
 * shell: it reads and writes full paths, and `Location` strips the base href exactly as it does
 * for `PathLocationStrategy`.
 */

import { Location, LocationStrategy, type LocationChangeListener } from '@angular/common'
import type { BoundaryLocation, NavigationBridge, Unsubscribe } from '@company/mfe-core'

function hrefOf(location: BoundaryLocation, includeHash: boolean): string {
  const path = `${location.pathname}${location.search}`
  return includeHash ? `${path}${location.hash}` : path
}

export class BoundaryLocationStrategy extends LocationStrategy {
  readonly #bridge: NavigationBridge
  readonly #baseHref: string
  readonly #subscriptions: Unsubscribe[] = []
  /** Where this strategy last left or found the page, so a notification that moved nothing is dropped. */
  #lastHref: string

  constructor(bridge: NavigationBridge, baseHref: string) {
    super()
    this.#bridge = bridge
    this.#baseHref = baseHref
    this.#lastHref = hrefOf(bridge.read(), true)
  }

  override path(includeHash = false): string {
    return hrefOf(this.#bridge.read(), includeHash)
  }

  /** The App's root is the boundary itself, so `/` maps to `/reports`, never `/reports/`. */
  override prepareExternalUrl(internal: string): string {
    const base = Location.stripTrailingSlash(this.#baseHref)
    if (base !== '' && /^\/?(?:[?#]|$)/.test(internal))
      return `${base}${internal.replace(/^\//, '')}`
    return Location.joinWithSlash(base === '' ? '/' : base, internal)
  }

  override getState(): unknown {
    return this.#bridge.readState?.() ?? null
  }

  override pushState(state: unknown, _title: string, url: string, queryParams: string): void {
    this.#bridge.push(this.#externalUrl(url, queryParams), state)
    this.#lastHref = hrefOf(this.#bridge.read(), true)
  }

  override replaceState(state: unknown, _title: string, url: string, queryParams: string): void {
    this.#bridge.replace(this.#externalUrl(url, queryParams), state)
    this.#lastHref = hrefOf(this.#bridge.read(), true)
  }

  override forward(): void {
    this.#bridge.forward()
  }

  override back(): void {
    this.#bridge.back()
  }

  /** A bridge without `go` takes the nearest single step, rather than none. */
  override historyGo(relativePosition = 0): void {
    if (this.#bridge.go) {
      this.#bridge.go(relativePosition)
      return
    }
    if (relativePosition < 0) this.#bridge.back()
    else if (relativePosition > 0) this.#bridge.forward()
  }

  override onPopState(fn: LocationChangeListener): void {
    this.#subscriptions.push(
      this.#bridge.subscribe(location => {
        const href = hrefOf(location, true)
        if (href === this.#lastHref) return
        this.#lastHref = href
        // Outside the boundary the host is replacing this App; routing a path the App does not
        // own would only fail inside a router that is about to be destroyed.
        if (!this.#owns(location.pathname)) return
        fn({ type: 'popstate', state: this.#bridge.readState?.() ?? null })
      }),
    )
  }

  override getBaseHref(): string {
    return this.#baseHref
  }

  /** Called from the application's `DestroyRef`, because the strategy outlives nothing else. */
  dispose(): void {
    for (const unsubscribe of this.#subscriptions.splice(0)) unsubscribe()
  }

  #externalUrl(url: string, queryParams: string): string {
    return this.prepareExternalUrl(url + Location.normalizeQueryParams(queryParams))
  }

  #owns(pathname: string): boolean {
    const base = Location.stripTrailingSlash(this.#baseHref)
    return base === '' || pathname === base || pathname.startsWith(`${base}/`)
  }
}
