# Contributing

The conventions below are defined once here and enforced mechanically wherever
practical, so reviews can be about clarity and behaviour rather than personal
formatting preferences.

## The one command

```sh
pnpm check
```

runs, in order: required generation, format check, lint, strict typecheck,
package-boundary checks and the test suites. CI runs the same action and never
silently rewrites authored files.

Individual steps: `pnpm format`, `pnpm format:check`, `pnpm lint`,
`pnpm typecheck`, `pnpm boundaries`, `pnpm test`.

## File and export conventions

- **File names** are kebab-case and describe the thing, not its category:
  `action-registry.ts`, not `actions/index-impl.ts`. A file whose only job is
  to re-export is `index.ts`.
- **Local imports carry their extension** (`./errors.ts`, `./mount-context.tsx`).
  The TypeScript configuration rewrites them on emit.
- **Imports are grouped**: external packages, then workspace packages, then
  local modules, separated by blank lines. Type-only imports use
  `import type` — the lint preset enforces this.
- **Named exports are canonical.** A default export appears only where a
  contract asks for one, such as a container exporting exactly one definition.
- Every package's public surface goes through its `src/index.ts`. Deep imports
  into another package are a boundary violation and the lint preset rejects them.

## Modules that export components

React Refresh replaces a module in place only when it can prove **every** export
is a component. One exported hook, constant or factory beside them makes the
module unable to accept an update: the update propagates to whatever imported
it, and to whatever imported that, until it reaches an entry — which accepts
nothing, so the page reloads and every piece of state on it is lost.

The failure is silent. Everything still works; it is only slower and starts
over each time, which reads as a bundler problem rather than a module-shape one.

So: in a module that exports components, export only components. Hooks,
constants and factories go in their own module beside it. This applies to an
MFE's render functions too — `src/mfe.ts` exports a definition and a contract by
contract, so a Widget written inline in its entry reloads the page on every
edit; `pnpm create @company/mfe` scaffolds the render into its own module for that
reason.

`pnpm hmr:probe <file> [url]`, against servers you already started, answers the
question for one file: it puts a value on `window` that a reload cannot carry,
edits the file, and reports whether the module was replaced or the page was.

The second rule is for the build itself: **generated output must be a pure
function of the sources.** The build regenerates before every compilation, and
the container imports what it generates, so a timestamp, a counter or a random
id in a generated module makes every compilation a source change and the
container rebuilds forever — which reaches a developer as hot updates that fail
to fetch and a page that reloads (`docs/decisions.md` §19). `writeGeneratedFiles`
skips a file whose contents are unchanged, and that is only worth anything if
unchanged sources produce unchanged bytes.

## Writing implementation code

- Give each module one coherent responsibility, and keep package dependencies
  aligned with the import DAG. Separate validation, state transitions, external
  side effects and framework-specific rendering where that makes behaviour
  easier to follow.
- Use the same term for the same operation across packages. Loading, mounting,
  retrying, disposal and output delivery each have one name; do not introduce a
  synonym.
- Prefer explicit control flow, focused functions and early returns over deep
  nesting, dense expressions or boolean mode flags. Do not fragment a readable
  operation to satisfy an arbitrary line count.
- Keep state ownership, mutation points, cancellation, subscriptions and cleanup
  visible. Lifecycle and retry transitions belong in one cohesive implementation,
  not scattered across unrelated effects.
- Introduce a shared helper for repeated _semantics_, not for superficial
  syntactic similarity. A small amount of clear duplication beats a misleading
  abstraction, and an abstraction whose only consumer would be a hypothetical
  future adapter should not exist yet.

## Errors and diagnostics

Every developer-facing failure goes through `createMfeError` or `toMfeError`
from `@company/mfe-core`, and its message names:

1. the definition and, where known, its version;
2. the operation and the relevant field or resource;
3. what was expected, when the failure can name it;
4. what was observed;
5. one concrete repair step.

For example, `validateAgainstContract` rejecting `alertId: 7` against
`examples/alert-panel`'s contract:

> ```
> alert-panel@1.4.0 failed to accept input alertId: 7; ✖ Invalid input: expected string, received number
>   → at alertId. Check the alertId prop on the Widget.
> ```

A schema failure folds the expectation into what it observed, because Zod's own
rendering already names both. Build diagnostics
(`packages/mfe-build/src/diagnostics.ts`) carry one sentence more, naming which
side declared the expectation; nothing at run time does, because `declaredBy`
was removed from `MfeErrorDetails`.

The code is a machine artifact; the message is what somebody actually reads
while debugging. Budget real effort for it. Redact tokens and sensitive payload
fields — diagnostic usefulness never requires logging a whole input.

Do not mix silent catches, logging-only failures and thrown errors for
equivalent operations. Errors reach the diagnostics sink; nothing in a framework
package writes to `console`.

## Comments

Comments explain **why** a decision exists — especially for race handling and
performance-sensitive code — and never narrate the next statement. Remove stale
comments, dead code and commented-out implementations.

Do not cite specification section numbers in code. Describe the rule in plain
words instead, so the comment stays useful to somebody who does not have the
document open.

## Performance work

Choose the clearest implementation that meets the measured requirement. When an
optimization adds complexity, keep it local, record the measured reason and the
invariant it depends on, and cover the behaviour it could break with a focused
test. Do not add a cache, memoization, custom equality or a mutable shortcut
without identifying both the work it avoids and the invalidation or cleanup it
requires — and do not remove a proven optimization for aesthetic uniformity
without rechecking the measurement that justified it.

## Tests

Behaviour-oriented names and a recognizable arrange/act/assert structure. Shared
fixtures should clarify the scenario and expose the inputs that matter, rather
than hiding setup behind a general-purpose test framework.

Assert observable behaviour. Where a contract is about _absence_ of work — an
unchanged snapshot, a subscriber that must not be notified, a validation that
must not run twice — assert the counts, not just the rendered output. A cached
render can otherwise conceal excessive upstream work.

## Suppressions

A lint suppression names one rule, sits on the line it applies to, and carries a
specific reason:

```ts
// eslint-disable-next-line react-hooks/exhaustive-deps -- the remaining options
// are part of the key's module-scope declaration and cannot legally change;
// including them would rebind the key on every render.
```

"Noisy" is not a reason. Never disable a check across a package to accommodate
one exception.

## Dependencies

Every dependency version lives once, in the `catalog` block of
`pnpm-workspace.yaml`, and packages reference it as `catalog:`. Adding a version
anywhere else is drift.

Installation scripts are opt-in: `pnpm-workspace.yaml` sets
`strictDepBuilds: true` and `dangerouslyAllowAllBuilds: false`, and each entry in
`allowBuilds` records why that dependency may run one — including explicit
denials. Review the package, the resolved version, the script and the reason
before changing that map, and commit the decision alongside the dependency
change. Never use bulk approval to repair an install.

## Review

Automated checks are necessary but do not establish clean code. Every change is
also reviewed for readable control flow, explicit ownership and cleanup,
consistent conventions with neighbouring code, and justified abstractions.
Unresolved readability or consistency defects in changed code block it, exactly
as functional defects do.
