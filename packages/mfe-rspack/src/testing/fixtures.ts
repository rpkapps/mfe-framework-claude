/** A React container: React as its dependency, and installed, since it names the share scope. */

import { createContainerFixture } from '@company/mfe-build/testing'

export { cleanupContainers } from '@company/mfe-build/testing'

export interface ContainerFixtureOptions {
  readonly manifest?: Record<string, unknown>
  /**
   * Package versions installed into the container's `node_modules`, as manifests only. Defaults
   * to React, whose version names the container's share scope.
   */
  readonly installed?: Readonly<Record<string, string>>
}

const REACT_INSTALLED: Readonly<Record<string, string>> = { react: '19.3.0' }

/** Writes a container into a temporary directory and returns its root. */
export function createContainer(
  files: Readonly<Record<string, string>>,
  options: ContainerFixtureOptions = {},
): string {
  const installed = options.installed ?? REACT_INSTALLED

  return createContainerFixture(files, {
    manifest: {
      name: '@acme/operations',
      version: '1.0.0',
      type: 'module',
      dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' },
      ...options.manifest,
    },
    installed: Object.fromEntries(
      Object.entries(installed).map(([name, version]) => [name, { version }]),
    ),
  })
}
