/**
 * The federation half of the package, which loads neither the TypeScript compiler nor PostCSS: a
 * host's own build config reads its share scope through here without paying for discovery.
 */

export { createBuildError, isMfeBuildError, MfeBuildError } from '../diagnostics.ts'
export type { BuildDiagnosticDetails } from '../diagnostics.ts'

export { buildFederationOptions, withFrameworkMetadata } from './federation-options.ts'
export type { FederationOptions } from './federation-options.ts'
export {
  adapterCarriedShares,
  adapterDependencies,
  pagePolicy,
  resolveFrameworkScope,
} from './framework-scope.ts'
export type { AdapterDependencies, FrameworkScopeOptions } from './framework-scope.ts'
export { installedVersionFrom } from './installed-version.ts'
export {
  containerDependencies,
  frameworkShareScope,
  isUsableVersionRange,
  PAGE_POLICY,
  PAGE_SHARE_SCOPE,
  PAGE_SINGLETON,
  packageOf,
  resolveShared,
  shareScopesOf,
  SINGLETON,
  sortedByName,
  withPagePolicy,
} from './sharing.ts'
export type {
  ResolveSharedOptions,
  SharedModuleConfig,
  SharingPolicies,
  SharingPolicy,
} from './sharing.ts'
