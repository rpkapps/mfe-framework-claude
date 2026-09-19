/**
 * Breadcrumb composition across mounts: order contributions parent-to-child and
 * publish the composed trail, so a nested App contributes exactly as a
 * top-level one does. The equality rules matter as much as the ordering — an
 * inline array of unchanged records must be a no-op for shell subscribers.
 */

import {
  breadcrumbTrailEqual,
  createMfeError,
  DEV,
  SnapshotSource,
  type BreadcrumbItem,
  type DiagnosticsHub,
  type Unsubscribe,
} from '@company/mfe-core'

const EMPTY_TRAIL: readonly BreadcrumbItem[] = Object.freeze([])

export interface BreadcrumbContributionHandle {
  /** Publishes the latest committed route-derived items for this mount. */
  update(items: readonly BreadcrumbItem[]): void
  remove(): void
}

interface Contribution {
  readonly definitionId: string
  readonly depth: number
  /** Insertion order within a depth, so siblings stay deterministic. */
  readonly sequence: number
  /** Route-derived items, composed when no override is active. */
  routeItems: readonly BreadcrumbItem[]
  /** Active override; replaces this mount's own portion of the trail only. */
  override: readonly BreadcrumbItem[] | null
  /** Identifies the component that installed the override. */
  overrideOwner: string | null
  /** Navigation counter, so an override cannot outlive the navigation it began in. */
  navigationId: number
  /** The navigation the active override was bound to. */
  overrideNavigationId: number
}

export interface BreadcrumbStoreOptions {
  readonly diagnostics?: DiagnosticsHub
}

export class BreadcrumbStore {
  readonly #contributions = new Map<string, Contribution>()
  readonly #trail = new SnapshotSource<readonly BreadcrumbItem[]>(EMPTY_TRAIL, {
    areEqual: breadcrumbTrailEqual,
  })
  readonly #options: BreadcrumbStoreOptions
  #sequence = 0

  constructor(options: BreadcrumbStoreOptions = {}) {
    this.#options = options
  }

  /** Stable references for `useSyncExternalStore`. */
  readonly getSnapshot = (): readonly BreadcrumbItem[] => this.#trail.getSnapshot()
  readonly subscribe = (listener: () => void): Unsubscribe => this.#trail.subscribe(listener)

  get contributionCount(): number {
    return this.#contributions.size
  }

  /** An App that opted out never registers, which does not affect nested Apps. */
  registerMount(
    definitionId: string,
    mountToken: string,
    depth: number,
  ): BreadcrumbContributionHandle {
    this.#sequence += 1
    const contribution: Contribution = {
      definitionId,
      depth,
      sequence: this.#sequence,
      routeItems: EMPTY_TRAIL,
      override: null,
      overrideOwner: null,
      navigationId: 0,
      overrideNavigationId: -1,
    }
    this.#contributions.set(mountToken, contribution)

    let active = true
    return {
      update: items => {
        if (!active) return
        if (breadcrumbTrailEqual(contribution.routeItems, items)) return
        contribution.routeItems = items
        this.#compose()
      },
      remove: () => {
        if (!active) return
        active = false
        this.#contributions.delete(mountToken)
        this.#compose()
      },
    }
  }

  /**
   * Installs the single permitted override for a mount, bound to the navigation
   * it mounted in. A second, competing override produces an explicit diagnostic
   * rather than a result that depends on render order.
   */
  setOverride(mountToken: string, items: readonly BreadcrumbItem[], ownerToken: string): void {
    const contribution = this.#contributions.get(mountToken)
    if (!contribution) return

    const hasLiveOverride =
      contribution.override !== null &&
      contribution.overrideNavigationId === contribution.navigationId

    // An owner whose override was retired by a navigation cannot install it
    // again: its steps belong to the route it began in, and a hook that somehow
    // outlived that navigation would otherwise leak them into the next one.
    if (
      !hasLiveOverride &&
      contribution.overrideOwner === ownerToken &&
      contribution.overrideNavigationId !== contribution.navigationId
    ) {
      return
    }

    if (hasLiveOverride && contribution.overrideOwner !== ownerToken) {
      // A developer mistake, reported and then ignored either way, so the
      // report and its sentences leave a production build.
      if (DEV) {
        this.#options.diagnostics?.report(
          createMfeError({
            code: 'app/invalid-router',
            id: contribution.definitionId,
            operation: 'install a breadcrumb override',
            expected: 'at most one active breadcrumb override per App mount',
            observed: 'a second override while another is still mounted',
            repair:
              'Unmount the first override before mounting the second, or lift it into one component. Competing overrides would otherwise resolve by render order.',
          }),
          { severity: 'warning' },
        )
      }
      return
    }

    if (hasLiveOverride && breadcrumbTrailEqual(contribution.override ?? EMPTY_TRAIL, items)) {
      // Equal items on an ordinary rerender: keep the published trail as it is.
      return
    }

    contribution.override = items
    contribution.overrideOwner = ownerToken
    contribution.overrideNavigationId = contribution.navigationId
    this.#compose()
  }

  clearOverride(mountToken: string, ownerToken: string): void {
    const contribution = this.#contributions.get(mountToken)
    if (!contribution || contribution.override === null) return
    if (contribution.overrideOwner !== ownerToken) return

    contribution.override = null
    contribution.overrideOwner = null
    this.#compose()
  }

  /** Clears any active override, so a multi-step flow cannot leak into the next route. */
  notifyNavigation(mountToken: string): void {
    const contribution = this.#contributions.get(mountToken)
    if (!contribution) return

    contribution.navigationId += 1
    if (contribution.override === null) return

    // `overrideOwner` deliberately survives: it is what identifies the owner
    // whose binding this navigation just retired.
    contribution.override = null
    this.#compose()
  }

  dispose(): void {
    this.#contributions.clear()
    this.#trail.dispose()
  }

  /** Unchanged records keep their references; an equal trail is never republished. */
  #compose(): void {
    const ordered = [...this.#contributions.values()].sort(
      (a, b) => a.depth - b.depth || a.sequence - b.sequence,
    )

    const composed: BreadcrumbItem[] = []
    for (const contribution of ordered) {
      for (const item of contribution.override ?? contribution.routeItems) composed.push(item)
    }

    this.#trail.set(composed.length === 0 ? EMPTY_TRAIL : Object.freeze(composed))
  }
}
