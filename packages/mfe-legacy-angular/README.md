# `@company/mfe-legacy-angular`

The removable legacy adapter. It is the only package in the framework that knows
the legacy single-spa contract, the legacy registry vocabulary and the
`<name>/single-spa-app` expose path.

Nothing else in the workspace imports it. When the last legacy Angular
application is migrated, this directory is deleted, the shell drops one entry
from its adapter-selection table and one import from its composition root, and
no other package changes. The package boundary check enforces the other half of
that promise: this package never depends on React, on a router, or on
`@company/mfe-react`.

## What is proven here, and what is not

**Everything in this package is built and verified against production-equivalent
contract fixtures and test doubles. The legacy Angular repositories are not
available in this environment, so nothing here has been run against the real
applications.** The fixtures encode the contract those applications are expected
to honour — the registry fields they publish, the lifecycles their
`./single-spa-app` module exports, the base-href seams they use and the router
behaviour their initializer had. What the fixtures cannot prove is that the real
applications actually match them. That check is a first run of a real legacy
container against this adapter, and it is still outstanding.

Concretely, the tests prove: the translation of every legacy registry field; that
an entry advertising a malformed new contract is never claimed by this adapter;
the parcel mount, unmount, remount, failure and disposal behaviour against a
structural parcel double; both documented base-href seams including the
fallback; every shell-owned route pattern; and the release-notes sibling
resolution together with its behaviour once an App owns its own release notes.

They do not prove: that a real legacy container exposes lifecycles in the shape
the double models; that a real Angular app's `Router` behaves as the router
double does; that the real single-spa `mountRootParcel` sequences bootstrap and
mount as assumed; or that the two seam values (`/asset-tracker/` and
`/rigstream/`) match what those applications actually ship.

## Registry translation

`createLegacyAdapterRule()` is the second rule in the shell's selection table,
registered after the rule for the new framework contract. A shell passes it to
`createMfeRuntime`, which always evaluates the contract rule first and appends
whatever it is given:

```ts
import { createLegacyAdapterRule } from '@company/mfe-legacy-angular'
import { createMfeRuntime } from '@company/mfe-react'

const { runtime } = createMfeRuntime({
  registryEntries,
  rules: [createLegacyAdapterRule()],
  // …loader, shellState, telemetryProvider
})
```

It claims an entry only when the entry does **not** advertise the new contract
(no `mfe` key) and carries the minimum legacy metadata — an app `name` and an
`mfManifestUrl`.

That ordering is the no-silent-fallback guarantee. An entry that advertises the
new contract belongs to the new adapter whatever state its advertisement is in;
if this rule claimed a malformed one, a typo in new metadata would quietly change
how an app loads instead of failing loudly. `advertises` therefore asks only
whether the new contract was advertised at all, and never inspects how well.

Translation puts identity, manifest URL and presentation in the neutral record,
and every legacy-specific field in `adapterData`, where only this package reads
it. The neutral record stays free of legacy vocabulary.

| Legacy `AppConfig` field | Where it goes                     | Notes                                                                                                                                   |
| ------------------------ | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                   | `id`, `adapterData.containerName` | `id` is the name reduced to the framework identity rules; the name itself is preserved because the loader registers the remote under it |
| `mfManifestUrl`          | `manifestUrl`                     | Also the base for the release-notes sibling document                                                                                    |
| `title`                  | `title`                           | Omitted when the legacy entry omitted it                                                                                                |
| `icon`                   | `icon`                            | Omitted when the legacy entry omitted it                                                                                                |
| `version`                | `version`                         | Never gates loading or selection                                                                                                        |
| `hidden`                 | `hidden`                          | Catalog flag only, not a security boundary                                                                                              |
| `onboardingType`         | `adapterData.onboardingType`      |                                                                                                                                         |
| `tags`                   | `adapterData.tags`                | Empty array when absent                                                                                                                 |
| `categories`             | `adapterData.categories`          | Empty array when absent                                                                                                                 |
| `externalUrl`            | `adapterData.externalUrl`         |                                                                                                                                         |
| `routes`                 | `adapterData.routes`              | Empty array when absent                                                                                                                 |
| `settings.routes`        | `adapterData.settingsRoutes`      | Flattened to one array                                                                                                                  |
| —                        | `adapterData.exposeName`          | Always `./single-spa-app`                                                                                                               |
| —                        | `adapterData.navigationOwnership` | Always `shell`                                                                                                                          |

Shell surfaces read the payload back through `readLegacyAdapterData(entry)`,
which is typed and refuses an entry that belongs to another adapter, so a
translation change is a compile error rather than an empty tile.

Validation failures throw structured framework errors that name the field, what
was expected, what arrived and the repair. The host quarantines the entry and
keeps the rest of the registry.

## Parcel lifecycle

The existing loading shape is preserved exactly, not replaced by the new App
loader:

1. `registerRemotes([{ name, entry: mfManifestUrl }])`
2. `loadRemote('<name>/single-spa-app')`
3. mount the resulting module through the single-spa parcel lifecycle.

`createLegacyContainerLoader({ runtime })` implements the host's
`ContainerLoader` port for steps 1 and 2. The federation runtime is injected, in
the same style as the React adapter's loader, so importing this module starts
nothing and tests need no runtime. Containers are registered once each. A
registration failure is reported against the manifest URL, a load failure against
the unchanged expose path, and a module without `bootstrap`, `mount` and
`unmount` is reported with the lifecycles it is missing. Lifecycles exported
behind `default` are accepted, because both shapes exist.

`LegacyParcelMount` drives step 3. It calls the injected `mountRootParcel`, waits
on `parcel.mountPromise`, and tears down with `parcel.unmount()`. Its status is
`idle`, `mounting`, `mounted`, `unmounting`, `error` or `disposed`, and it is
observable through `subscribe`. Unmounting returns it to `idle`, from which a
remount is a plain second mount that creates a fresh parcel. Mounting twice
without an unmount is refused rather than silently ignored, because two parcels
rendering into one element leave orphaned DOM behind. Disposal is terminal and
idempotent: every caller awaits the same teardown, the parcel is unmounted at
most once, a failed teardown still leaves the mount disposed, and a disposed
mount cannot be resurrected.

The parcel, its config and `mountRootParcel` are structurally typed in
`src/parcel/single-spa-contract.ts`. `single-spa` is not a dependency of this
package at all, not even an optional peer, which is what lets the whole
lifecycle be tested without single-spa, Angular or a bundler.

## Base href and navigation ownership

Legacy apps keep `APP_BASE_HREF` and their existing base-href behaviour. Two
seams are documented, and `resolveLegacyBaseHref` implements both:

- **app-pinned** — the app provides its own base href and keeps it even when the
  shell offers a different one. `asset-tracker` uses `/asset-tracker/`.
- **delegated** — the app consumes the base href single-spa supplies in its
  props, and falls back to its own prefix when the shell supplies none.
  `rigstream` falls back to `/rigstream/`.

A legacy app not in the seam table delegates and falls back to `/<name>/`, so a
third legacy app needs no new code. A shell can pass its own seam table instead
of editing this package.

New Apps default to App-owned navigation. The legacy adapter declares the
opposite explicitly: every resolved base href carries
`navigationOwnership: 'shell'`, the adapter payload carries it, the loaded module
carries it and the migration seam carries it. The shell owns the URL for a legacy
app, and the migration provider below is what keeps Angular from writing it a
second time.

## The migration edit

Each legacy app replaces exactly one provider. Everything else stays:
`provideRouter`, `singleSpaAngular`, the route tree, all feature code, the app's
own `APP_BASE_HREF` provider, and the `./single-spa-app` Module Federation
exposure.

Before:

```ts
import { skipLocationChangeOnNonImperativeRoutingTriggers } from './app/shell/navigation'

providers: [
  // ...
  provideAppInitializer(skipLocationChangeOnNonImperativeRoutingTriggers),
]
```

After:

```ts
import { createLegacyShellNavigationInitializer } from '@company/mfe-legacy-angular/angular'

providers: [
  // ...
  provideAppInitializer(
    createLegacyShellNavigationInitializer({
      name: 'asset-tracker',
      injectRouter: () => inject(Router),
    }),
  ),
]
```

`injectRouter` is called from inside the initializer, which is where Angular's
injection context is available. The initializer returns `undefined` on purpose:
Angular waits on anything promise-like an initializer returns, so the teardown is
handed to the optional `registerTeardown` callback instead — pass
`teardown => inject(DestroyRef).onDestroy(teardown)` to tie the subscription to
the app's injector.

Angular is deliberately **not** a dependency of this package and must not become
one: the app owns its Angular version, and a framework package that imported
Angular would pin it for every consumer. The Angular types the seam touches —
`Router.events`, `Router.getCurrentNavigation()`, `NavigationExtras` — are
described structurally, and Angular's own `Router` satisfies them.

The behaviour of the replaced initializer is preserved verbatim: on a navigation
triggered by anything other than the app itself (browser back and forward, or the
shell driving single-spa), `skipLocationChange` is set on the current navigation
so Angular does not write the location again. Writing it twice is what makes the
back button skip entries.

`createLegacyMigrationSeam({ name, baseHref, routes, settingsRoutes })` returns
what the edit preserves, in a form a test can assert rather than a comment can
promise: the resolved base href and the `APP_BASE_HREF` value, the single-spa
activity predicate derived from it, the parcel expose path, the route metadata,
shell-owned navigation, and the name of the single provider it replaces. The same
seam is attached to the initializer as `initializer.seam`.

## Shell-owned legacy routes

The shell keeps serving these patterns for legacy apps, in this evaluation order:

| Pattern                  | Serves                        |
| ------------------------ | ----------------------------- |
| `settings`               | the shell's own settings      |
| `:name/settings`         | one app's settings            |
| `release-notes`          | the shell's own release notes |
| `:name/release-notes`    | one app's release notes       |
| `solutions-health`       | the shell's own health page   |
| `:name/solutions-health` | one app's health page         |
| `:name/**`               | everything else under an app  |

Order is part of the contract: the catch-all is last so it cannot swallow a more
specific legacy route. `matchLegacyShellRoute(pathname)` returns the first
pattern that claims a path together with the captured app name and catch-all
remainder, or `null` when the shell should look elsewhere; `isLegacyShellRoute`
is the same question as a predicate. Query strings, fragments, leading and
trailing slashes are ignored.

## Release notes

Legacy release notes are a `release-notes.md` document published next to the
container manifest. `resolveLegacyReleaseNotesUrl(manifestUrl)` is plain URL
resolution — the sibling of the manifest, in whatever directory the manifest
lives — so a container that moves its manifest moves its release notes with it.
A relative manifest URL needs an explicit `base`; the resolver refuses to guess
one.

`createLegacyReleaseNotesSource({ fetch })` fetches that document through an
injected fetch and reports a missing or unreachable document as a structured
error naming the status.

This path is a compatibility fallback and stays available for every entry. The
App-owned release-notes capability is **additive**: `selectReleaseNotesRoute`
sends the shell into an App that advertises the capability and keeps the legacy
sibling document for every App that does not, and advertising the capability does
not disable the legacy path for anyone — including for the app that advertised
it.

## Tests

```sh
pnpm vitest run --project legacy-angular
pnpm --filter @company/mfe-legacy-angular typecheck
node tools/boundaries/check-boundaries.mjs
```
