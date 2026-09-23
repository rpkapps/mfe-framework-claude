/**
 * `@company/mfe-react/registry` — the registry adapter alone. It imports no React, so a shell
 * written in another framework registers React containers without resolving React itself.
 */

export { reactAdapter, type ReactRegistryEntry } from './react-adapter.ts'
