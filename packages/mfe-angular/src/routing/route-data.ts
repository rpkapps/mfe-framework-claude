/**
 * The framework's slice of a route's `data`: the capability a route serves and the breadcrumb it
 * contributes. The build reads capability routes statically out of the App's route files, so a
 * capability route must write `data: mfeRouteData({ … })` inline, beside a literal `path`.
 */

import type { CapabilityIconRef, CapabilityName } from '@company/mfe-core'

/** The key the framework's data lives under, so it never collides with an App's own keys. */
export const MFE_ROUTE_DATA = 'mfe' as const

export interface MfeRouteData {
  /** Publishes this route as one of the App's capability pages, such as its settings. */
  readonly capability?: CapabilityName
  /** Required with `capability`: what the shell calls the page. */
  readonly label?: string
  readonly icon?: CapabilityIconRef
  /** A fixed breadcrumb label, or `false` to leave the route out of the trail. */
  readonly breadcrumb?: string | false
}

/** Frozen, because route data is shared by every navigation to the route. */
export function mfeRouteData(data: MfeRouteData): { readonly [MFE_ROUTE_DATA]: MfeRouteData } {
  return Object.freeze({ [MFE_ROUTE_DATA]: Object.freeze({ ...data }) })
}
