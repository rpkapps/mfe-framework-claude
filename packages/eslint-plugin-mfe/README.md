# @company/eslint-plugin-mfe

The shared lint contract for this monorepo and for every repository that ships an
MFE against it: composable flat-config presets and five MFE-specific rules.

The presets are where the framework's boundaries become something a developer
meets in the editor, on the line that broke them, with the repair in the message.
The rules cover the failures that no general-purpose rule can see, because
they are about what it means to be one fragment of a page you do not own.

This package is development-only. It is never part of the runtime import DAG.

---

## Three entry points

One package, one plugin object and one `mfe/` rule namespace, in three entries,
so a workspace imports the one for the code it lints:

| Entry                                | Holds                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `@company/eslint-plugin-mfe`         | the rules, the `framework` and `tooling` presets, and `application()`, the import boundary for a shell |
| `@company/eslint-plugin-mfe/react`   | `author()`, the preset for a React container                                                           |
| `@company/eslint-plugin-mfe/angular` | `angular()`, the preset for an Angular 19 zoneless container                                           |

Each framework's lint plugins are **optional peer dependencies**:
`eslint-plugin-react-hooks`, `@tanstack/eslint-plugin-query` and
`@tanstack/eslint-plugin-router` for `author()` (and `framework()`, which lints
React packages), and `@angular-eslint/eslint-plugin`,
`@angular-eslint/eslint-plugin-template` and `@angular-eslint/template-parser`
(19 to 22) for `angular()`. A preset loads its own peers when it is called,
never when its entry is imported, so an Angular workspace never installs React
tooling and the other way round. A missing peer throws one error that names
every package to install.

## Install and use

```ts
// eslint.config.ts, in a framework repository
import mfe from '@company/eslint-plugin-mfe'

export default [...mfe.configs.framework]
```

```ts
// eslint.config.ts, in a React MFE repository
import mfe from '@company/eslint-plugin-mfe'
import react from '@company/eslint-plugin-mfe/react'

export default [
  ...react.author({
    tsconfigRootDir: import.meta.dirname,
    widgetScopes: ['src/widgets/**'],
    storageAllowedScopes: ['src/bootstrap/storage.ts'],
  }),
  ...mfe.tooling({ tsconfigRootDir: import.meta.dirname }),
]
```

```ts
// eslint.config.ts, in an Angular MFE project (what @company/mfe-nx generates)
import mfe from '@company/eslint-plugin-mfe'
import angular from '@company/eslint-plugin-mfe/angular'

export default [
  ...angular.angular({ tsconfigRootDir: import.meta.dirname, widgetScopes: ['src/**'] }),
  ...mfe.tooling({ tsconfigRootDir: import.meta.dirname }),
]
```

Write the config as `eslint.config.ts`, not `.mjs`. This package's entry is
TypeScript, so a `.mjs` config reaches it as an untransformed `.ts` import that
only a Node with type stripping can read; a `.ts` config goes through jiti, which
transforms it and everything it imports on any Node. Install `jiti` alongside
ESLint.

These rules are about being one fragment of a page. They are not about the
design system, and they deliberately say nothing about it. `@tecton/eslint-config`
used to sit alongside them and catch an application restyling a component the
design system owns — and `bg-red-500`, which generates no CSS under Tecton's
palette and therefore fails silently. Tecton has removed that preset, so nothing
checks a class against the token set any more. `eslint.config.ts` at this
repository's root is the worked example of composing what remains.

Every preset but `application()` exists in two spellings that produce the same configuration:

| Spelling                                                                                              | Shape                           | Use it when                                       |
| ----------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------- |
| `mfe.configs.framework`, `mfe.configs.tooling`, `react.configs.author`, `angular.configs.angular`     | `Linter.Config[]`               | the defaults are right, and you want to spread    |
| `mfe.framework(options)`, `mfe.tooling(options)`, `react.author(options)`, `angular.angular(options)` | `(options?) => Linter.Config[]` | you need to declare scopes or a `tsconfigRootDir` |

The `configs` arrays are built when they are read, so reading `mfe.configs.tooling`
never loads the React peers `framework` needs.

Because a preset is a plain array, anything after it in your config wins. Turn a
rule down, scope one off for a directory, or drop a config object out of the
array entirely — nothing is hidden behind an opaque `extends`.

Every preset needs type information (`no-floating-promises` and the `no-unsafe-*`
family are the rules worth having here, and none of them work without a
program). They set `parserOptions.projectService: true`; pass `tsconfigRootDir`
if ESLint's working directory is not your project root. A file no `tsconfig.json`
includes has no program and reports a parsing error instead of a lint result, so
a build or test configuration file has to be in its package's `include`.

**`files` governs the whole preset.** Every config object a preset produces is
scoped to it, including ESLint's recommended baseline, and every narrower scope —
the package zones, `routerFiles`, and the test and generated-code overrides — is
_intersected_ with it rather than added to it. So a preset never reaches a file
you did not ask it to cover, and the parser and plugins are always registered
wherever the rules apply. The default is every TypeScript file; widen it if you
want plain JavaScript linted too. Every object also registers the plugins for the
rules it turns on, so re-scoping or dropping one object can never strand another
object's rules.

**`reactFiles` narrows the React rules to the packages that actually have React
in them.** It defaults to all of `files`, and is always intersected with it, so
nothing changes until you set it. Set it in a workspace that mixes React with
anything else:

```js
mfe.framework({
  files: ['packages/*/src/**/*.{ts,tsx}', 'apps/*/src/**/*.{ts,tsx}'],
  reactFiles: ['packages/mfe-react/src/**/*.{ts,tsx}', 'apps/shell/src/**/*.{ts,tsx}'],
})
```

React rules applied to a package with no React in it do not merely find nothing —
they produce false positives on any API that happens to share a name with a hook.
`rules-of-hooks` treats a call to anything named `use` as a hook call, so an
Rspack plugin building a module rule's `use:` loader list gets told it is calling
a React Hook outside a component. The repair is not to suppress the rule at each
site but to stop applying React rules to code that is not React. `reactFiles`
governs every React block: the `react-hooks` recommended config and the React
Compiler diagnostics alike, so no config object registers the `react-hooks`
plugin outside that scope.

---

## The `framework` preset

For the packages that implement the framework, such as `@company/mfe-core`,
`@company/mfe-runtime`, `@company/mfe-react`, `@company/mfe-angular`,
`@company/mfe-legacy-angular`, `@company/mfe-build`, `@company/mfe-rspack`,
`@company/mfe-devtools`.

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

  | Zone                          | May not import                                                                                                                                              |
  | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `@company/mfe-core`           | `react`, `react-dom`, `@tanstack/react-router`, `@tanstack/react-query`, `single-spa`, `@module-federation/*`, `@company/mfe-runtime`, `@company/mfe-react` |
  | `@company/mfe-runtime`        | the same, minus itself                                                                                                                                      |
  | `@company/mfe-react`          | `single-spa`                                                                                                                                                |
  | `@company/mfe-legacy-angular` | `react`, `react-dom`, `@tanstack/react-router`, `@company/mfe-react`                                                                                        |
  | `@company/mfe-devtools`       | `@company/mfe-rspack` (the developer tools read the runtime, never the build integration), `single-spa`                                                     |

  Every zone also inherits `STATE_PATHS` and `TELEMETRY_PATTERNS`, so the
  restrictions below apply inside each one on top of the row above.

- **State and telemetry boundaries**, across every framework file: `zustand`,
  `redux`, `@reduxjs/toolkit`, `react-redux`, `mobx`, `mobx-react-lite`,
  `jotai`, `@tanstack/store` and `@tanstack/react-store` are out, because a
  framework package would force one of them on every consumer; `@opentelemetry/*`
  and `@grafana/faro-*` are out **including type imports**, because a type import
  still couples the package to a vendor's release cadence and still shows up in
  its published declarations. The AI and agent libraries (`ai`, `@tanstack/ai-*`,
  `@ai-sdk/*`, `@ag-ui/*`, `@copilotkit/*`, the model providers' SDKs) are out on
  the same terms: a framework package runs inside every container. The one
  exception is `@company/mfe-chat`, the shell's chat client, which may import
  `@ag-ui/*` and nothing else; the author presets reject it in a container.
- **Contracts only in `@company/mfe-core`**: a zone that rejects, outside its
  tests, an exported class other than an error, a top-level `let`, `var`, `Map`,
  `Set` or `WeakMap`, a timer call, and the browser globals (`window`,
  `document`, storage, `history`, `location`, `fetch`, `navigator`). State
  belongs in `@company/mfe-runtime`.
- **The four MFE rules** below, which every package gets; inside
  `@company/mfe-angular` their messages name the Angular adapter's APIs.

### Options

```ts
mfe.framework({
  tsconfigRootDir: import.meta.dirname,
  files: ['**/*.ts', '**/*.tsx'],
  reactFiles: ['packages/mfe-react/src/**/*.{ts,tsx}', 'apps/shell/src/**/*.{ts,tsx}'],
  storageAllowedScopes: ['packages/mfe-runtime/src/storage/**'],
  widgetScopes: [],
  extraRestrictedPaths: [],
  extraRestrictedPatterns: [],
})
```

---

## The `author` preset, from `/react`

For React MFE Apps and Widgets. An author's constraints are the mirror image of the
framework's: application state is yours, the page is not.

Everything in the `framework` preset's general layers applies, and then:

- **TanStack Query** (`@tanstack/eslint-plugin-query`, `flat/recommended`) across
  the source, and **TanStack Router** (`@tanstack/eslint-plugin-router`,
  `flat/recommended`) scoped to router code — by default `**/routes/**/*.{ts,tsx}`,
  `**/*.route.{ts,tsx}`, `**/*.routes.{ts,tsx}`, `**/router.{ts,tsx}` and
  `**/routeTree.gen.ts`. Override with `routerFiles`.
- **Framework internals are off limits**: `@company/mfe-core`,
  `@company/mfe-runtime`, `react-dom/client`, and any deep path such as
  `@company/mfe-react/src/*`, `@company/mfe-core/*` or `@company/mfe-runtime/*`.
  `@company/mfe-react` is the author-facing entry point and re-exports the types.
- **zustand is allowed.** An MFE owns its own state. What it may not own is the
  framework's internals, the React root, or a telemetry SDK: `@opentelemetry/*`
  and `@grafana/faro-*` stay restricted, type imports included, in favour of
  `useTelemetry()` from `@company/mfe-react` and `context.mfe.telemetry` in a
  route callback. The AI and agent libraries are restricted too, type imports
  included: an App or Widget offers the agent its actions with `useAction()`,
  and the shell's chat talks to the agent.
- **Generated router output** (`routeTree.gen.ts`, `src/generated/**`) is exempt
  from the rules that would only ever blame the generator.

### Options

```ts
react.author({
  tsconfigRootDir: import.meta.dirname,
  files: ['**/*.ts', '**/*.tsx'],
  reactFiles: ['src/**/*.{ts,tsx}'],
  widgetScopes: ['src/widgets/**'],
  storageAllowedScopes: [],
  routerFiles: react.DEFAULT_ROUTER_FILES, // the default; omit it, or spread it to add to it
  extraRestrictedPaths: [],
  extraRestrictedPatterns: [],
})
```

---

## The `angular` preset, from `/angular`

For Angular 19 zoneless MFE Apps and Widgets: the mirror of `author()`, on the
same general layers, with Angular's own APIs named in every message.

- **angular-eslint's recommended rules**, for TypeScript and for templates,
  listed explicitly rather than spread from the `angular-eslint` meta package:
  the meta package peers on `@angular/cli`, and its recommended set spans later
  Angular versions than the adapter targets. Inline templates are extracted
  with `@angular-eslint/template/extract-inline-html` and linted as `.html`.
- **Zoneless, and the host owns the application**: `zone.js` (and its subpaths),
  `NgZone`, `bootstrapApplication`, `createApplication` and
  `@angular/platform-browser-dynamic` are errors, each with the repair.
- **Framework internals are off limits**, as in `author()`, pointing at
  `@company/mfe-angular`, its `/host` and its `/testing`.
- **The five MFE rules**, `mfe/no-widget-global-router` included, naming
  `injectMfeSignal()`, `injectStoredState()`, `injectMfeStorage()` and
  `injectWidgetEmit()` in their messages.

### Options

```ts
angular.angular({
  tsconfigRootDir: import.meta.dirname,
  files: ['**/*.ts'],
  templateFiles: angular.DEFAULT_ANGULAR_TEMPLATE_FILES, // ['**/*.html']
  widgetScopes: ['src/**'],
  storageAllowedScopes: [],
  extraRestrictedPaths: [],
  extraRestrictedPatterns: [],
})
```

---

## The `application()` preset

For code that hosts mounted definitions rather than being one: a shell, or a test
harness that places definitions from several adapters. It rejects
`@company/mfe-core` and `@company/mfe-runtime` (and their subpaths), any deep
path into the adapters, and `@module-federation/*`, with messages pointing at the
adapter's root, `/host` and `/testing`. It needs no optional peer.

```ts
mfe.application({
  files: ['apps/shell/src/**/*.{ts,tsx}'],
  adapterModules: ['@company/mfe-react'], // every adapter a cross-adapter harness hosts
  extraRestrictedPaths: [],
  extraRestrictedPatterns: [],
})
```

It sets one rule, `@typescript-eslint/no-restricted-imports`, and ESLint keeps the
last value a file matches, so for the files it covers it _replaces_ what an
earlier preset restricted rather than adding to it. Restate anything else you
still want in `extraRestrictedPatterns`, as this repository's root config does
for the vendor telemetry ban.

---

## The `tooling` preset

For a workspace's build and test configuration: the bundler and test-runner
configs, the test setup files, and the hand-written declarations beside a
plain-JavaScript helper. None of it is part of the runtime import DAG, so the
MFE rules and the package zones say nothing about it — but it is TypeScript a
person writes and breaks, so the recommended baselines and the async,
type-safety and maintainability layers apply exactly as they do elsewhere.

`files` defaults to `mfe.DEFAULT_TOOLING_FILES`: `eslint.config`, `rsbuild.config`,
`vite.config`, `vitest.config` and `vitest.setup`. It deliberately does not match
`*.config.ts` on its own, because a file named after the package it configures —
`src/mfe.config.ts` — is that package's source and belongs to that package's
preset. Pass `files` to add the ones a workspace names differently.

In a setup file, `no-empty-object-type` allows an interface with a single
`extends`: a matcher library reaches the runner's `Assertion` through an
interface that extends it and declares nothing of its own, and declaration
merging accepts no other shape. That is the preset's only exception — the rules
the other two relax in test scope are ones this preset never turns on.

### Options

```ts
mfe.tooling({
  tsconfigRootDir: import.meta.dirname,
  files: [...mfe.DEFAULT_TOOLING_FILES, 'source.config.ts'],
})
```

---

## Scoped exceptions

The `framework`, `author` and `angular` presets switch five rules off in test files, and only in test files
(`**/*.test.{ts,tsx,mts,cts}`, `**/*.spec.{ts,tsx,mts,cts}`, `**/__tests__/**`,
`**/vitest.setup.{ts,tsx}` — never a whole package). Each is a considered
exception, recorded here so nobody has to guess later whether it was deliberate.

| Rule                                       | Why it is off in tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@typescript-eslint/unbound-method`        | The rule exists to catch a method reference that will lose its `this` when it is eventually called. In `expect(obj.method).toHaveBeenCalled()` and `vi.spyOn(obj, 'method')` the reference is never called through the lost binding at all: it is handed to the assertion or the spy as a value to be identified, not invoked. Every report in that position is a false positive.                                                                                                      |
| `@typescript-eslint/require-await`         | A test helper or fake is frequently `async` on purpose, to match the signature of the real thing it stands in for, while awaiting nothing. The rule cannot distinguish that from a genuinely forgotten `await`.                                                                                                                                                                                                                                                                        |
| `@typescript-eslint/no-non-null-assertion` | Under `noUncheckedIndexedAccess` every indexed read in an assertion is `T \| undefined`, so `results[0]!.line` is the idiomatic spelling; the alternative — `expect(results[0]).toBeDefined()` followed by optional chaining everywhere — adds noise without adding safety. The failure mode also differs by context: in production a wrong `!` is a crash in front of a user, while in a test it fails that test immediately with a clear error, which is exactly what a test is for. |
| `mfe/no-global-patching`                   | A test for that rule, or for code that reacts to a patched global, has to patch one to have anything to assert on.                                                                                                                                                                                                                                                                                                                                                                     |
| `mfe/no-raw-storage`                       | A storage test has to reach the storage it is verifying.                                                                                                                                                                                                                                                                                                                                                                                                                               |

Every one of these stays **on** in production code. `no-non-null-assertion` in
particular is an error outside test scope, because the argument above turns on
what a failing assertion costs, and in production it costs a user.

**Nothing else is relaxed in tests, deliberately.** `no-floating-promises`, the
whole `no-unsafe-*` family and the React Hooks rules all stay on in test code,
because they find real defects there — an unawaited promise in a test is one of
the most common causes of a flaky suite. If you are tempted to add a sixth entry
to that table, write the reason first; if the reason is "noisy", it belongs in
the code rather than in this list.

---

## Rules

All five resolve names through ESLint's scope manager rather than by matching
identifier text, so an aliased import is caught under its alias and a shadowing
local binding is not caught at all. They work without type information, so they
can run in a plain parser setup.

None of them autofixes: no repair here preserves semantics. `mfe/no-raw-storage`
offers a **suggestion**, which a human accepts; the others explain the
repair in the message and leave it to you. The messages below are the React
wording, which is each rule's default; the options that change it are how the
`angular()` preset names the Angular adapter's APIs instead.

| Rule                                                           | What it reports                                                                                      |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [`mfe/no-global-patching`](#mfeno-global-patching)             | replacing `fetch`, the History API, or listener registration on `window`, `document` or `globalThis` |
| [`mfe/stable-definitions`](#mfestable-definitions)             | `createApp`, `createWidget` or `lazyWidget` called anywhere but module scope                         |
| [`mfe/no-raw-storage`](#mfeno-raw-storage)                     | direct `localStorage` / `sessionStorage` access                                                      |
| [`mfe/no-widget-global-effects`](#mfeno-widget-global-effects) | History navigation and document-head mutation inside declared Widget scopes                          |
| [`mfe/no-widget-global-router`](#mfeno-widget-global-router)   | a Widget calling Angular's `Router` to navigate, inside declared Widget scopes                       |

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

**Options.** Only the wording; the defaults are React's.

```ts
'mfe/no-global-patching': ['error', {
  signalHook: 'useMfeSignal()',
  signalModule: '@company/mfe-react',
  navigationHint: "`navigate` or `Link` from your App's boundary router, …",
  navigatorModule: '@company/mfe-runtime',
}]
```

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
import { z } from 'zod'

import { Summary } from './summary.tsx'

export function Panel() {
  // A new definition identity on every render.
  return createWidget({
    id: 'reports-summary',
    inputSchema: z.object({ reportId: z.string() }),
    outputSchema: z.object({ opened: z.object({ reportId: z.string() }) }),
    render: Summary,
  })
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
  return useMemo(() => lazyWidget('alert-panel', { contract: { inputSchema, outputSchema } }), [])
}

// A class field initialiser runs per construction, not per module.
import { createApp } from '@company/mfe-react'
export class Holder {
  app = createApp({ id: 'reports', router: makeRouter })
}
```

**Valid**

```tsx
import { createApp, createWidget, lazyWidget } from '@company/mfe-react'
import { z } from 'zod'

import { inputSchema, outputSchema } from '@example/alert-panel/contracts'
import { makeRouter } from './router.ts'
import { Summary } from './summary.tsx'

export const app = createApp({ id: 'reports', router: makeRouter })

export const widget = createWidget({
  id: 'reports-summary',
  inputSchema: z.object({ reportId: z.string() }),
  outputSchema: z.object({ opened: z.object({ reportId: z.string() }) }),
  render: Summary,
})

// Consuming one: an id, and the contract its own build published.
const AlertPanel = lazyWidget('alert-panel', { contract: { inputSchema, outputSchema } })

export function Panel() {
  // Reference the definition, do not rebuild it.
  return <AlertPanel alertId="a-42" />
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
  modules: ['@company/mfe-react', '@company/mfe-runtime', '@company/mfe-core'],
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
import { z } from 'zod'

// Module scope: the schema is part of the key's declaration, not a per-render value.
const prefs = z.object({ density: z.enum(['compact', 'comfortable']) })
const theme = z.enum(['light', 'dark', 'system'])

export function usePrefs() {
  const storage = useMfeStorage()
  return storage.key('prefs', prefs).get()
}

export function useTheme() {
  return useStoredState('theme', theme, { defaultValue: 'system' })
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
    'packages/mfe-runtime/src/storage/**',   // the adapter that implements the boundary
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
rewrites the object and nothing else: the file still has to bind
`const storage = useMfeStorage()` and spell the read the boundary's way,
`storage.key('k', schema).get()`.

**Options**

```ts
'mfe/no-raw-storage': ['error', {
  allowedScopes: [],                            // globs; default: none
  objects: ['localStorage', 'sessionStorage'],
  storageAccessor: 'storage',                   // what the suggestion rewrites to
  storedStateHook: 'useStoredState()',          // the wording, React's by default
  storageHook: 'useMfeStorage()',
  adapterModule: '@company/mfe-react',
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
// The repair the message asks for: an output this Widget declares, emitted from
// its render props, which a React host hands to the `onNavigate` prop.
export function Panel({ emit }) {
  return () => emit('navigate', { to: '/reports' })
}

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
only by accident; declare a navigation output in the Widget's `outputSchema`
and call `emit('navigate', { to })` from its render props, and the owning App
receives the output and navigates with its own boundary router, or the shell with
the host `BoundaryNavigator`. For the title: several Widgets can be
mounted at once, so the last to render would win and the tab title would
flicker; declare a title output and call `emit('title', { text })`, and the
owning App sets what it owns. For head metadata: the favicon, `<meta>` and
`<title>` belong to the shell, and the change would outlive your unmount;
declare an output for the value and `emit` it, and the App that applies it is
also the one that reverts it.

**Options**

```ts
'mfe/no-widget-global-effects': ['error', {
  widgetScopes: [], // globs; default: none, which makes the rule inert
  emitAccess: 'its render props', // the wording; `injectWidgetEmit()` under angular()
}]
```

---

### mfe/no-widget-global-router

The Angular counterpart of `mfe/no-widget-global-effects`. Angular's `Router`
navigates the whole page, so a Widget that injects it and calls `navigate` or
`navigateByUrl` moves the host router, the owning App and every sibling MFE
behind their backs. Only the `angular()` preset turns it on, and like its React
counterpart it reports only inside the globs listed in `widgetScopes`.

**Invalid** (inside a declared Widget scope)

```ts
import { Router } from '@angular/router'

export class PanelComponent {
  private readonly router = inject(Router)

  open(): void {
    void this.router.navigateByUrl('/reports')
  }
}
```

**Valid**

```ts
// The repair: an output this Widget declares, emitted through injectWidgetEmit().
export class PanelComponent {
  readonly #emit = injectWidgetEmit<typeof panelContract>()

  open(): void {
    this.#emit('navigate', { to: '/reports' })
  }
}
```

**What the message says.** A Widget does not drive the URL; declare a navigation
output in the Widget's `outputSchema` and call `emit('navigate', { to })` from
`injectWidgetEmit()`, and the owning App navigates with its own `Router`, scoped
to its `BoundaryLocationStrategy`, or the shell with the host
`BoundaryNavigator`.

**Options**

```ts
'mfe/no-widget-global-router': ['error', {
  widgetScopes: [], // globs; default: none, which makes the rule inert
  emitAccess: '`injectWidgetEmit()`',
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
