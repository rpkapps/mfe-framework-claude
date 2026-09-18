# @company/eslint-plugin-mfe

The shared lint contract for this monorepo and for every repository that ships an
MFE against it: two composable flat-config presets and four MFE-specific rules.

The presets are where the framework's boundaries become something a developer
meets in the editor, on the line that broke them, with the repair in the message.
The four rules cover the failures that no general-purpose rule can see, because
they are about what it means to be one fragment of a page you do not own.

This package is development-only. It is never part of the runtime import DAG.

---

## Install and use

```js
// eslint.config.mjs, in a framework repository
import mfe from '@company/eslint-plugin-mfe'

export default [...mfe.configs.framework]
```

```js
// eslint.config.mjs, in an MFE repository
import mfe from '@company/eslint-plugin-mfe'

export default [
  ...mfe.author({
    tsconfigRootDir: import.meta.dirname,
    widgetScopes: ['src/widgets/**'],
    storageAllowedScopes: ['src/bootstrap/storage.ts'],
  }),
]
```

Both presets exist in two spellings that produce the same configuration:

| Spelling                                        | Shape                           | Use it when                                       |
| ----------------------------------------------- | ------------------------------- | ------------------------------------------------- |
| `mfe.configs.framework`, `mfe.configs.author`   | `Linter.Config[]`               | the defaults are right, and you want to spread    |
| `mfe.framework(options)`, `mfe.author(options)` | `(options?) => Linter.Config[]` | you need to declare scopes or a `tsconfigRootDir` |

Because a preset is a plain array, anything after it in your config wins. Turn a
rule down, scope one off for a directory, or drop a config object out of the
array entirely — nothing is hidden behind an opaque `extends`.

Both presets need type information (`no-floating-promises` and the `no-unsafe-*`
family are the rules worth having here, and none of them work without a
program). They set `parserOptions.projectService: true`; pass `tsconfigRootDir`
if ESLint's working directory is not your project root.

**`files` governs the whole preset.** Every config object a preset produces is
scoped to it, including ESLint's recommended baseline, and every narrower scope —
the package zones, `routerFiles`, and the test and generated-code overrides — is
_intersected_ with it rather than added to it. So a preset never reaches a file
you did not ask it to cover, and the parser and plugins are always registered
wherever the rules apply. The default is every TypeScript file; widen it if you
want plain JavaScript linted too. Every object also registers the plugins for the
rules it turns on, so re-scoping or dropping one object can never strand another
object's rules.

---

## The `framework` preset

For the packages that implement the framework: `@company/mfe-core`,
`@company/mfe-host`, `@company/mfe-react`, `@company/mfe-legacy-angular`,
`@company/mfe-rspack`.

It layers:

- **ESLint's recommended baseline**, read from the installed ESLint's own rule
  metadata rather than from a second copy of that list.
- **typescript-eslint's type-checked recommended** configuration.
- **React Hooks and React Compiler**: `eslint-plugin-react-hooks` 7's
  `recommended-latest`, plus the compiler diagnostics it ships but leaves off
  (`capitalized-calls`, `memo-dependencies`, `memoized-effect-dependencies`,
  `exhaustive-effect-dependencies`, `no-deriving-state-in-effects`,
  `void-use-memo`, `rule-suppression`). An MFE that silently fails to compile
  loses the memoisation the host sized its performance budget around.
- **Async correctness**: `no-floating-promises`, `no-misused-promises`,
  `await-thenable`, `return-await`, `require-atomic-updates`.
- **Type safety**: the whole `no-unsafe-*` family, `no-explicit-any`,
  `no-non-null-assertion`, `consistent-type-assertions` (no object-literal
  assertions), and `switch-exhaustiveness-check` so a new lifecycle state or
  error code has to be handled everywhere it is switched on.
- **Maintainability**: TS-aware `no-unused-vars`, `no-shadow`,
  `consistent-type-imports`, `consistent-type-exports`,
  `no-import-type-side-effects`, and `ban-ts-comment` with a required
  description of at least ten characters.
- **The package import DAG**, as `@typescript-eslint/no-restricted-imports`
  zones, one per package, mirroring `tools/boundaries/check-boundaries.mjs`:

  | Zone                          | May not import                                                                                                                                           |
  | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `@company/mfe-core`           | `react`, `react-dom`, `@tanstack/react-router`, `@tanstack/react-query`, `single-spa`, `@module-federation/*`, `@company/mfe-host`, `@company/mfe-react` |
  | `@company/mfe-host`           | the same, minus itself, plus `@company/mfe-react`                                                                                                        |
  | `@company/mfe-react`          | `single-spa`                                                                                                                                             |
  | `@company/mfe-legacy-angular` | `react`, `react-dom`, `@tanstack/react-router`, `@company/mfe-react`                                                                                     |

- **State and telemetry boundaries**, across every framework file: `zustand`,
  `redux`, `@reduxjs/toolkit`, `react-redux`, `mobx`, `mobx-react-lite`,
  `jotai`, `@tanstack/store` and `@tanstack/react-store` are out, because a
  framework package would force one of them on every consumer; `@opentelemetry/*`
  and `@grafana/faro-*` are out **including type imports**, because a type import
  still couples the package to a vendor's release cadence and still shows up in
  its published declarations.
- **The four MFE rules** below.

### Options

```ts
mfe.framework({
  tsconfigRootDir: import.meta.dirname,
  files: ['**/*.ts', '**/*.tsx'],
  storageAllowedScopes: ['packages/mfe-host/src/storage/**'],
  widgetScopes: [],
  extraRestrictedPaths: [],
  extraRestrictedPatterns: [],
})
```

---

## The `author` preset

For MFE Apps and Widgets. An author's constraints are the mirror image of the
framework's: application state is yours, the page is not.

Everything in the `framework` preset's general layers applies, and then:

- **TanStack Query** (`@tanstack/eslint-plugin-query`, `flat/recommended`) across
  the source, and **TanStack Router** (`@tanstack/eslint-plugin-router`,
  `flat/recommended`) scoped to router code — by default `**/routes/**/*.{ts,tsx}`,
  `**/*.route.{ts,tsx}`, `**/*.routes.{ts,tsx}`, `**/router.{ts,tsx}` and
  `**/routeTree.gen.ts`. Override with `routerFiles`.
- **Framework internals are off limits**: `@company/mfe-core`,
  `@company/mfe-host`, `react-dom/client`, and any deep path such as
  `@company/mfe-react/src/*`, `@company/mfe-core/*` or `@company/mfe-host/*`.
  `@company/mfe-react` is the author-facing entry point and re-exports the types.
- **zustand is allowed.** An MFE owns its own state. What it may not own is the
  framework's internals, the React root, or a telemetry SDK: `@opentelemetry/*`
  and `@grafana/faro-*` stay restricted, type imports included, in favour of
  `useTelemetry()` from `@company/mfe-react` and `context.mfe.telemetry` in a
  route callback.
- **Generated router output** (`routeTree.gen.ts`, `src/generated/**`) is exempt
  from the rules that would only ever blame the generator.

### Options

```ts
mfe.author({
  tsconfigRootDir: import.meta.dirname,
  files: ['**/*.ts', '**/*.tsx'],
  widgetScopes: ['src/widgets/**'],
  storageAllowedScopes: [],
  routerFiles: mfe.DEFAULT_ROUTER_FILES,
  extraRestrictedPaths: [],
  extraRestrictedPatterns: [],
})
```

---

## Rules

All four resolve names through ESLint's scope manager rather than by matching
identifier text, so an aliased import is caught under its alias and a shadowing
local binding is not caught at all. They work without type information, so they
can run in a plain parser setup.

None of them autofixes: no repair here preserves semantics. `mfe/no-raw-storage`
offers a **suggestion**, which a human accepts; the other three explain the
repair in the message and leave it to you.

| Rule                                                           | What it reports                                                                                      |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [`mfe/no-global-patching`](#mfeno-global-patching)             | replacing `fetch`, the History API, or listener registration on `window`, `document` or `globalThis` |
| [`mfe/stable-definitions`](#mfestable-definitions)             | `createApp`, `createWidget` or `lazyWidget` called anywhere but module scope                         |
| [`mfe/no-raw-storage`](#mfeno-raw-storage)                     | direct `localStorage` / `sessionStorage` access                                                      |
| [`mfe/no-widget-global-effects`](#mfeno-widget-global-effects) | History navigation and document-head mutation inside declared Widget scopes                          |

---

### mfe/no-global-patching

A micro-frontend shares one realm with the shell and with every other MFE.
Replacing `fetch`, the History API or the event-listener plumbing is not a local
decision: it changes behaviour for code the author has never seen, it survives
the MFE's own unmount, and the winner is whichever bundle evaluated last.

Reported: assignment to, `delete` of, or `Object.defineProperty` /
`Reflect.defineProperty` on `globalThis.fetch` / `window.fetch`,
`history.pushState` / `history.replaceState`, `window.history` itself, and
`addEventListener` / `removeEventListener` on `window`, `document` or
`globalThis`.

**Invalid**

```ts
globalThis.fetch = instrumentedFetch
window['fetch'] = instrumentedFetch
;(globalThis as unknown as { fetch: unknown }).fetch = instrumentedFetch
Object.defineProperty(globalThis, 'fetch', { value: instrumentedFetch })
delete window.fetch

history.pushState = patchedPushState
window.history.replaceState = patchedReplaceState
window.history = fakeHistory

window.addEventListener = patchedAdd
document.removeEventListener = patchedRemove
```

**Valid**

```ts
// Reading is not patching.
const original = globalThis.fetch

// Calling is not patching.
window.addEventListener('resize', onResize)
history.pushState(null, '', '/reports')

// A binding that merely shares the global's name.
import { history } from './router.ts'
history.pushState = noop

function withFakeWindow(window: { fetch: unknown }) {
  window.fetch = stub
}

element.addEventListener = spy
```

**What the message says.** For `fetch`: patching it replaces `fetch` for the
shell and for every other MFE in the page, and the last bundle to evaluate wins;
wrap your own requests in a module-local client and pass `useMfeSignal()`
(`@company/mfe-react`) as the request signal, because page-wide instrumentation is
the shell's to install, once. For history: the patch hijacks navigation for the
whole page, so the host router and the other MFEs learn about a navigation only
by accident; use `navigate` or `Link` from your App's boundary router, or the
host `BoundaryNavigator` in the shell. For listeners: the patch changes event
dispatch for every MFE and outlives your unmount; register listeners normally and
pass `{ signal: useMfeSignal() }`, which `@company/mfe-react` aborts on unmount.

**Options:** none.

---

### mfe/stable-definitions

`createApp`, `createWidget` and `lazyWidget` produce a _definition_: a stable
identity that the host keys its registry, mount lifecycle, router integration and
query cache on. Called inside a component, a hook or any other function body,
they mint a fresh identity on every call, so the host sees a different MFE each
render: it unmounts the running tree, discards its state and refetches. The
symptom is an MFE that flickers and forgets.

**Invalid**

```ts
import { createWidget } from '@company/mfe-react'

export function Panel() {
  return createWidget({ id: 'reports/summary' }) // a new definition per render
}
```

```ts
// An alias is still the framework's factory.
import { createWidget as mk } from '@company/mfe-react'
export const Panel = () => mk({ id: 'a' })

// So is a namespace member, and a local re-alias.
import * as mfe from '@company/mfe-react'
export function useWidget() {
  return mfe.createWidget({ id: 'a' })
}

// The classic: rebuilt inside a memo.
import { lazyWidget } from '@company/mfe-react'
export function Panel() {
  return useMemo(() => lazyWidget(load), [])
}

// A class field initialiser runs per construction, not per module.
import { createApp } from '@company/mfe-react'
export class Holder {
  app = createApp({ id: 'reports' })
}
```

**Valid**

```ts
import { createApp, createWidget, lazyWidget } from '@company/mfe-react'

export const app = createApp({ id: 'reports' })
export const widget = createWidget({ id: 'reports/summary' })
export const Chart = lazyWidget(() => import('./chart.ts'))

export function Panel() {
  return render(widget) // reference the definition, do not rebuild it
}
```

```ts
// Shadowing: a local function of the same name is not the framework's.
function createWidget(config: unknown) {
  return config
}
export function Panel() {
  return createWidget({ id: 'a' })
}

// Shadowing by parameter, even with the real import in the module.
import { createWidget } from '@company/mfe-react'
export function makeWidget(createWidget: (c: unknown) => unknown) {
  return createWidget({ id: 'a' })
}

// A same-named factory from somewhere else entirely.
import { createWidget } from './local-factory.ts'
```

**What the message says.** The factory has to be called once, at module scope;
calling it in _(the body of `Panel`, an arrow function, a class field
initialiser, …)_ mints a new definition identity on every call, so the host
treats it as a different MFE: it unmounts the running instance, throws away its
state and refetches its data. Move the call to the top level of the module and
reference the resulting definition. The message names the local spelling, the
exported name it resolved to, and the module it came from.

**Options**

```ts
'mfe/stable-definitions': ['error', {
  modules: ['@company/mfe-react', '@company/mfe-host', '@company/mfe-core'],
  factories: ['createApp', 'createWidget', 'lazyWidget'],
}]
```

---

### mfe/no-raw-storage

`localStorage` and `sessionStorage` are one flat, unversioned key space shared by
the shell and by every MFE in the origin. Written directly, keys collide across
MFEs, they cannot be namespaced per deployment, the shell cannot clear or migrate
them on sign-out, and a quota error surfaces as an unhandled exception in
whichever MFE wrote last.

**Invalid**

```ts
const prefs = localStorage.getItem('prefs')
sessionStorage.setItem('draft', body)
window.localStorage.setItem('prefs', body)
const backing = globalThis.sessionStorage
const raw = localStorage
```

**Valid**

```ts
import { useMfeStorage, useStoredState } from '@company/mfe-react'

export function usePrefs() {
  const storage = useMfeStorage()
  return storage.getItem('prefs')
}

export function useTheme() {
  return useStoredState('theme', 'system')
}
```

```ts
// Shadowing: a parameter or a local double of the same name.
export function read(localStorage: Storage) {
  return localStorage.getItem('k')
}

// A type position is not runtime access.
export type Backing = typeof localStorage
```

**Legitimate exceptions** are declared, never inferred from a file name. The
framework's own storage adapter and a documented shell override bootstrap opt out
by explicit scope:

```js
'mfe/no-raw-storage': ['error', {
  allowedScopes: [
    'packages/mfe-host/src/storage/**',   // the adapter that implements the boundary
    'apps/shell/src/bootstrap/storage.ts', // the documented shell override
  ],
}]
```

**What the message says.** The access bypasses the MFE storage boundary: the key
is not namespaced, so another MFE in this origin can read or overwrite it, the
shell cannot clear it on sign-out, and a quota failure escapes as an unhandled
exception. Use `useStoredState()` for component state or `useMfeStorage()` for
imperative access, both from `@company/mfe-react`; the adapter and a documented
shell override bootstrap opt out through `allowedScopes`.

**Suggestion.** A single local replacement of the storage object with the
project's accessor — `localStorage.getItem('k')` becomes
`storage.getItem('k')` — offered as a suggestion rather than a fix, because it
only compiles once the file binds `useMfeStorage()`.

**Options**

```ts
'mfe/no-raw-storage': ['error', {
  allowedScopes: [],                            // globs; default: none
  objects: ['localStorage', 'sessionStorage'],
  storageAccessor: 'storage',                   // what the suggestion rewrites to
}]
```

---

### mfe/no-widget-global-effects

A Widget is an embedded fragment: it does not own the URL and it does not own the
document head. If a Widget pushes history, the whole page navigates behind the
host router's back; if it writes `document.title` or swaps the favicon, the last
Widget to render wins and the page flickers between MFEs. Apps and the shell may
do both.

**Ownership is never guessed from a file name.** The rule reports only inside the
globs listed in `widgetScopes`, and with none configured it is inert.

```js
'mfe/no-widget-global-effects': ['error', {
  widgetScopes: ['src/widgets/**', 'examples/*/src/widgets/**'],
}]
```

**Invalid** (inside a declared Widget scope)

```ts
history.pushState(null, '', '/reports')
window.history.replaceState(null, '', '/reports')
history.back()
globalThis.history.go(-1)

document.title = 'Reports'
window.document.title = 'Reports'

const icon = document.querySelector('link[rel="icon"]')
const tag = document.querySelector('meta[name="description"]')
document.head.appendChild(iconLink)
document.head.innerHTML = '<title>Reports</title>'
```

**Valid**

```ts
// The repair the message asks for.
ctx.emit('navigate', { to: '/reports' })

import { useNavigate } from '@tanstack/react-router'
export function Panel() {
  const navigate = useNavigate()
  return () => navigate({ to: '/reports' })
}

// Shadowing: a router history object of the same name.
import { history } from './router.ts'
history.replaceState(null, '', '/reports')

// A Widget's own subtree is exactly what a Widget is for.
const root = document.querySelector('.mfe-widget-root')
node.title = 'Total revenue'

// Reading page state is not mutating it.
const current = document.title
```

The same code in an App route, or in any file outside `widgetScopes`, is not
reported.

**What the message says.** For history: a Widget does not drive the URL, because
the host router, the owning App and every sibling MFE learn about the navigation
only by accident; emit the Widget's declared navigation event
(`ctx.emit("navigate", { to })`) and let the owning App navigate with its
boundary router, or the shell with the host `BoundaryNavigator`. For the title: several Widgets can be mounted at
once, so the last to render would win and the tab title would flicker; publish it
through the Widget's declared outputs and let the owning App apply it with the
host document-metadata API. For head metadata: the favicon, `<meta>` and
`<title>` belong to the shell, and the change would outlive your unmount; emit
the value and let the host document-metadata API apply and revert it.

**Options**

```ts
'mfe/no-widget-global-effects': ['error', {
  widgetScopes: [], // globs; default: none, which makes the rule inert
}]
```

---

## Scope globs

`allowedScopes` and `widgetScopes` take the familiar glob subset: `**` crosses
directory separators, `*` and `?` do not, and `{a,b}` is a flat alternation. A
pattern that does not start with `/` or `**` is implicitly prefixed with `**/`,
so `src/storage/**` matches that directory wherever it sits in the workspace.

## Development

```sh
pnpm vitest run --project eslint-plugin
pnpm --filter @company/eslint-plugin-mfe typecheck
```
