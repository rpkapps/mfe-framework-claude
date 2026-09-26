/**
 * Breadcrumb composition across mounts, so a nested App contributes exactly as a top-level
 * one does. The equality rules matter as much as the ordering: an inline array of unchanged
 * records must be a no-op for shell subscribers.
 */

import {
  breadcrumbTrailEqual,
  createMfeError,
  HOST_SCOPE,
  type BreadcrumbItem,
  type Unsubscribe,
} from '@company/mfe-core'

import { DEV } from '../dev.ts'
import type { DiagnosticsHub } from '../diagnostics.ts'
import { SnapshotSource } from '../observable.ts'

const EMPTY_TRAIL: readonly BreadcrumbItem[] = Object.freeze([])

/** The host composes at 0; a top-level App is 1, one nested inside it 2. */
const HOST_DEPTH = 0

export interface BreadcrumbContributionHandle {
  update(items: readonly BreadcrumbItem[]): void
  remove(): void
}

interface Contribution {
  readonly definitionId: string
  readonly depth: number
  /** Insertion order within a depth, so siblings stay deterministic. */
  readonly sequence: number
  /** Composed when no override is active. */
  routeItems: readonly BreadcrumbItem[]
  /** Replaces this mount's own portion of the trail only. */
  override: readonly BreadcrumbItem[] | null
  overrideOwner: string | null
  /** Navigation counter, so an override cannot outlive the navigation it began in. */
  navigationId: number
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
    // `removeMount` may have taken the contribution already, before its owner's cleanup ran.
    const live = (): boolean => active && this.#contributions.get(mountToken) === contribution
    return {
      update: items => {
        if (!live()) return
        if (breadcrumbTrailEqual(contribution.routeItems, items)) return
        contribution.routeItems = items
        this.#compose()
      },
      remove: () => {
        if (!live()) return
        active = false
        this.#contributions.delete(mountToken)
        this.#compose()
      },
    }
  }

  /**
   * A mount's crumbs, and any override inside it, go with it, whether or not the component that
   * contributed them has run its cleanup yet.
   */
  removeMount(mountToken: string): void {
    if (this.#contributions.delete(mountToken)) this.#compose()
  }

  /**
   * What one component contributes, by where it is. Inside a mount its items override only that
   * mount's own portion of the trail, and an empty list is *no override*, so a flow that is idle
   * leaves the App's route-derived crumbs in place. Outside every mount (`mountToken` null) they
   * are the host page's own crumbs, composed first. `ownerToken` tells two components apart, so
   * a competing override is diagnosed rather than winning by render order.
   */
  contribute(mountToken: string | null, ownerToken: string): BreadcrumbContributionHandle {
    if (mountToken === null) return this.registerMount(HOST_SCOPE, ownerToken, HOST_DEPTH)

    return {
      update: items => {
        if (items.length === 0) this.clearOverride(mountToken, ownerToken)
        else this.setOverride(mountToken, items, ownerToken)
      },
      remove: () => {
        this.clearOverride(mountToken, ownerToken)
      },
    }
  }

  /**
   * A second, competing override produces an explicit diagnostic rather than a result that
   * depends on render order.
   */
  setOverride(mountToken: string, items: readonly BreadcrumbItem[], ownerToken: string): void {
    const contribution = this.#contributions.get(mountToken)
    if (!contribution) return

    const hasLiveOverride =
      contribution.override !== null &&
      contribution.overrideNavigationId === contribution.navigationId

    // An owner whose override a navigation retired cannot install it again: its steps
    // belong to the route it began in and would otherwise leak into the next one.
    if (
      !hasLiveOverride &&
      contribution.overrideOwner === ownerToken &&
      contribution.overrideNavigationId !== contribution.navigationId
    ) {
      return
    }

    if (hasLiveOverride && contribution.overrideOwner !== ownerToken) {
      // Reported and then ignored either way, so the report and its sentences leave a
      // production build.
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

    // `overrideOwner` deliberately survives: it identifies the owner whose binding this
    // navigation just retired.
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
