/**
 * An Angular App marks a capability route with `data: mfeRouteData({ capability, … })`; this
 * finds those markers and the neutral build applies the capability contract to them, so the shell
 * knows the route exists before the App is loaded.
 */

import {
  collectCapabilities,
  isTestFile,
  objectProperty,
  stringLiteralValue,
  type CapabilityMarker,
  type ContainerProfile,
  type MarkerTerms,
} from '@company/mfe-build'

import {
  resolveAppRoutes,
  routeDataCalls,
  routeDataObject,
  routeDataPath,
  ROUTE_DATA_FACTORY,
  type AppRoutes,
} from './route-data.ts'

const ROUTE_DATA_TERMS: MarkerTerms = {
  removeOne: `the capability from one of their ${ROUTE_DATA_FACTORY} calls`,
  drop: `drop the capability from the ${ROUTE_DATA_FACTORY} call`,
}

/**
 * Every `mfeRouteData(…)` in the container's sources declaring a capability. The routes array is
 * only followed once a marker needs its path, so a container without one never reads it.
 */
export const readRouteDataCapabilities: NonNullable<
  ContainerProfile['readCapabilities']
> = context => {
  const { owner, sources } = context
  let appRoutes: AppRoutes | undefined
  const markers: CapabilityMarker[] = []

  for (const file of context.sourceFiles) {
    if (isTestFile(file)) continue
    // Most modules never mention it, and parsing is what the scan costs.
    if (!sources.read(file).includes(ROUTE_DATA_FACTORY)) continue
    const sourceFile = sources.parse(file)

    for (const call of routeDataCalls(sourceFile)) {
      const data = routeDataObject(sourceFile, call, owner.appId)
      const capability = objectProperty(data, 'capability')
      if (capability === undefined) continue

      markers.push({
        file,
        sourceFile,
        data,
        capability,
        path: () => {
          appRoutes ??= resolveAppRoutes(context.entryFile, sources)
          return routeDataPath(sourceFile, call, appRoutes, {
            name: stringLiteralValue(capability.initializer) ?? 'capability',
            ...(owner.appId === undefined ? {} : { appId: owner.appId }),
          })
        },
      })
    }
  }

  return collectCapabilities(markers, owner, ROUTE_DATA_TERMS)
}
