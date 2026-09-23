/**
 * `@company/mfe-angular/host` — what an Angular shell composes the page from: the runtime's whole
 * host surface, re-exported from the bare `@company/mfe-runtime` specifier, and the provider that
 * hands the runtime to the shell's components. Every adapter's `/host` is that same surface plus
 * its own framework's provider, so a shell moves between frameworks without relearning the
 * runtime, and an application depends on its adapter alone.
 *
 * Only the bare specifier is re-exported: under federation it resolves to the page's one shared
 * runtime, while a subpath is not a share key and would bundle a second copy.
 *
 * The host components, `<mfe-widget>` and `<mfe-app-host>`, are on the package root, because an
 * App places definitions with them too.
 */

export * from '@company/mfe-runtime'

export { provideMfeRuntime } from './provide-runtime.ts'
