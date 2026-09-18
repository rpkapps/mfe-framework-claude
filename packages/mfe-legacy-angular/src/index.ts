/**
 * `@company/mfe-legacy-angular` — the removable legacy adapter.
 *
 * It is the only package that knows the legacy single-spa contract, the legacy
 * registry vocabulary and the `<name>/single-spa-app` expose path. Nothing else
 * in the framework imports it, so when the last legacy app is migrated the
 * package is deleted and the selection table loses one entry.
 *
 * Everything here is built and verified against production-equivalent contract
 * fixtures and test doubles. The legacy applications are not part of this
 * repository, so no claim is made that it has been run against them.
 */

export {
  createLegacyAdapterRule,
  deriveLegacyDefinitionId,
} from './registry/legacy-rule.ts'

export {
  LEGACY_NAVIGATION_OWNERSHIP,
  LEGACY_PARCEL_EXPOSE_NAME,
  readLegacyAdapterData,
  type LegacyAdapterData,
  type LegacyAppConfig,
  type NavigationOwnership,
} from './registry/legacy-config.ts'

export {
  createLegacyContainerLoader,
  type LegacyContainerLoaderOptions,
  type LegacyFederationRuntime,
  type LegacyParcelModule,
} from './parcel/legacy-container-loader.ts'

export {
  LegacyParcelMount,
  type LegacyParcelMountOptions,
  type LegacyParcelStatus,
} from './parcel/parcel-mount.ts'

export {
  isLegacyParcelConfig,
  missingParcelLifecycles,
  type LegacyLifecycleFn,
  type LegacyParcel,
  type LegacyParcelConfig,
  type LegacyParcelProps,
  type MountRootParcel,
} from './parcel/single-spa-contract.ts'

export {
  defaultLegacyBaseHrefSeam,
  LEGACY_BASE_HREF_SEAMS,
  normalizeBaseHref,
  resolveLegacyBaseHref,
  type LegacyBaseHrefSeam,
  type LegacyBaseHrefSource,
  type ResolvedLegacyBaseHref,
  type ResolveLegacyBaseHrefOptions,
} from './base-href.ts'

export {
  createLegacyReleaseNotesSource,
  isLegacyShellRoute,
  LEGACY_RELEASE_NOTES_FILENAME,
  LEGACY_SHELL_ROUTE_PATTERNS,
  matchLegacyShellRoute,
  resolveLegacyReleaseNotesUrl,
  selectReleaseNotesRoute,
  type LegacyReleaseNotes,
  type LegacyReleaseNotesFetch,
  type LegacyReleaseNotesSource,
  type LegacyReleaseNotesSourceOptions,
  type LegacyShellRouteMatch,
  type LegacyShellRoutePattern,
  type ReleaseNotesRoute,
  type ResolveReleaseNotesOptions,
} from './shell-routes.ts'

export {
  createLegacyMigrationSeam,
  createLegacyShellNavigationInitializer,
  IMPERATIVE_NAVIGATION_TRIGGER,
  skipLocationChangeOnNonImperativeTriggers,
  type LegacyMigrationSeam,
  type LegacyMigrationSeamOptions,
  type LegacyNavigation,
  type LegacyNavigationExtras,
  type LegacyNavigationTeardown,
  type LegacyRouterEvent,
  type LegacyRouterEventStream,
  type LegacyRouterPort,
  type LegacyRouterSubscription,
  type LegacyShellNavigationInitializer,
  type LegacyShellNavigationOptions,
} from './angular/migration-provider.ts'
