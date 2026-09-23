/** How `mfeAppRoute` tells the `<mfe-app-host>` it routes to which App to mount. */

import type { Data } from '@angular/router'

/** Its own key, so it never collides with an App's data or with the framework's `mfe` key. */
const APP_ROUTE_KEY = 'mfeAppRoute'

export interface AppRouteData {
  readonly appId: string
  /** Overrides the boundary; by default it is derived from where the route matched. */
  readonly basePath?: string
}

export function appRouteData(data: AppRouteData): Data {
  return { [APP_ROUTE_KEY]: Object.freeze({ ...data }) }
}

export function readAppRoute(data: Data): AppRouteData | null {
  const value: unknown = data[APP_ROUTE_KEY]
  if (value === null || typeof value !== 'object') return null
  const { appId } = value as Partial<AppRouteData>
  return typeof appId === 'string' ? (value as AppRouteData) : null
}
