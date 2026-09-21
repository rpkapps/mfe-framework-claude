/**
 * The only package that knows the legacy single-spa contract, registry vocabulary and
 * expose path, so it is deleted whole once the last legacy app is migrated.
 */

export { createLegacyAdapterRule } from './registry/legacy-rule.ts'

export {
  readLegacyAdapterData,
  type LegacyAdapterData,
  type NavigationOwnership,
} from './registry/legacy-config.ts'

export {
  createLegacyContainerLoader,
  type LegacyFederationRuntime,
  type LegacyParcelModule,
} from './parcel/legacy-container-loader.ts'

export {
  LegacyParcelMount,
  type LegacyParcelMountOptions,
  type LegacyParcelStatus,
} from './parcel/parcel-mount.ts'

export type {
  LegacyParcel,
  LegacyParcelConfig,
  LegacyParcelProps,
  MountRootParcel,
} from './parcel/single-spa-contract.ts'

export {
  LEGACY_BASE_HREF_SEAMS,
  resolveLegacyBaseHref,
  type LegacyBaseHrefSeam,
  type LegacyBaseHrefSource,
  type ResolvedLegacyBaseHref,
  type ResolveLegacyBaseHrefOptions,
} from './base-href.ts'

export {
  createLegacyReleaseNotesSource,
  isLegacyShellRoute,
  LEGACY_SHELL_ROUTE_PATTERNS,
  matchLegacyShellRoute,
  resolveLegacyReleaseNotesUrl,
  selectReleaseNotesRoute,
  type LegacyReleaseNotes,
  type LegacyReleaseNotesFetch,
  type LegacyReleaseNotesSource,
  type LegacyShellRouteMatch,
  type LegacyShellRoutePattern,
  type ReleaseNotesRoute,
} from './shell-routes.ts'

export {
  createLegacyMigrationSeam,
  createLegacyShellNavigationInitializer,
  type LegacyMigrationSeam,
  type LegacyMigrationSeamOptions,
  type LegacyRouterPort,
  type LegacyShellNavigationInitializer,
  type LegacyShellNavigationOptions,
} from './angular/migration-provider.ts'
