/**
 * The entry point a legacy Angular app imports.
 *
 * It is a separate export path so an app pulls in the migration seam without
 * pulling in the shell-side loader and registry code, and so the one-line edit
 * has one obvious import to name.
 */

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
} from './migration-provider.ts'

export {
  defaultLegacyBaseHrefSeam,
  LEGACY_BASE_HREF_SEAMS,
  normalizeBaseHref,
  resolveLegacyBaseHref,
  type LegacyBaseHrefSeam,
  type LegacyBaseHrefSource,
  type ResolvedLegacyBaseHref,
  type ResolveLegacyBaseHrefOptions,
} from '../base-href.ts'

export {
  LEGACY_NAVIGATION_OWNERSHIP,
  LEGACY_PARCEL_EXPOSE_NAME,
  type NavigationOwnership,
} from '../registry/legacy-config.ts'
