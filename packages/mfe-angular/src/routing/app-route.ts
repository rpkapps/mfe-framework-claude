/**
 * Delegating part of an App's URL space to another App. The route matches the prefix and a
 * wildcard child swallows the rest, so the boundary is the URL above that remainder: the nested
 * App owns everything below it, and the parent's router never tries to resolve the child's paths.
 */

import type { Route } from '@angular/router'

import { MfeAppHostComponent } from '../host/app-host.component.ts'
import { appRouteData } from './app-route-data.ts'

export interface MfeAppRouteOptions {
  readonly appId: string
  /** The prefix the App is placed under, such as `'reports'`; Angular matches `**` only whole. */
  readonly path: string
  /** Overrides the boundary; the default is the parent's boundary joined with the matched prefix. */
  readonly basePath?: string
}

export function mfeAppRoute(options: MfeAppRouteOptions): Route {
  return {
    path: options.path,
    component: MfeAppHostComponent,
    data: appRouteData({
      appId: options.appId,
      ...(options.basePath === undefined ? {} : { basePath: options.basePath }),
    }),
    children: [{ path: '**', children: [] }],
  }
}
