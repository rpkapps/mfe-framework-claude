/** The made-up integration's containers: its adapter as a dependency, its framework installed. */

import { createContainerFixture, type InstalledFixturePackage } from './containers.ts'
import { TEST_FRAMEWORK_ANCHOR } from './profile.ts'

export { cleanupContainers, entryOf } from './containers.ts'

export interface ContainerFixtureOptions {
  readonly manifest?: Record<string, unknown>
  /**
   * Packages installed into the container's `node_modules`, as manifests only. Defaults to the
   * made-up framework's anchor, so the container has a framework share scope.
   */
  readonly installed?: Readonly<Record<string, InstalledFixturePackage>>
}

const FRAMEWORK_INSTALLED: Readonly<Record<string, InstalledFixturePackage>> = {
  [TEST_FRAMEWORK_ANCHOR]: { version: '19.3.0' },
}

/** Writes a container into a temporary directory and returns its root. */
export function createContainer(
  files: Readonly<Record<string, string>>,
  options: ContainerFixtureOptions = {},
): string {
  return createContainerFixture(files, {
    manifest: {
      name: '@acme/operations',
      version: '1.0.0',
      type: 'module',
      dependencies: { '@acme/mfe-adapter': '^1.0.0' },
      ...options.manifest,
    },
    installed: options.installed ?? FRAMEWORK_INSTALLED,
  })
}
