/**
 * `@company/mfe-angular/registry` — the registry adapter alone. It imports no Angular, so a shell
 * written in another framework registers Angular containers without resolving Angular itself.
 */

export { angularAdapter, type AngularRegistryEntry } from './angular-adapter.ts'
