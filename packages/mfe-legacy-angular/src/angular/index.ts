/** A separate export path, so a legacy app gets the migration seam without the shell-side code. */

export {
  createLegacyMigrationSeam,
  createLegacyShellNavigationInitializer,
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
