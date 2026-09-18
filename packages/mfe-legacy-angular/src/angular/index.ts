/**
 * The entry point a legacy Angular app imports: a separate export path so the
 * one-line edit has one obvious import to name, and so an app pulls in the
 * migration seam without the shell-side loader and registry code.
 */

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
