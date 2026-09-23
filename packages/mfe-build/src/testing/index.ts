/** `@company/mfe-build/testing`: the container fixture every build integration's tests share. */

export {
  cleanupContainers,
  createContainerFixture,
  entryOf,
  writeFile,
  writeJsonFile,
} from './containers.ts'
export type { ContainerFixture, InstalledFixturePackage } from './containers.ts'
