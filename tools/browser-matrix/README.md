# @company/browser-matrix

The browser support policy, as code.

The policy has two halves that have to be satisfied **together**:

1. **Feature floor.** Every supported browser must natively support each id in
   [`src/required-features.ts`](./src/required-features.ts) — chiefly CSS
   `@scope`, for which **no fallback ships**.
2. **Coverage target.** The resulting set must cover **at least 91% of global
   browser usage in aggregate**. This is one number for the whole matrix, not a
   91% bar per browser.

## Current result

`pnpm browser-matrix` currently **fails the gate**:

|                                 |              |
| ------------------------------- | ------------ |
| Measured aggregate global usage | **89.9685%** |
| Target                          | 91%          |
| Shortfall                       | 1.0315 pp    |
| caniuse-lite                    | 1.0.30001810 |
| browserslist                    | 4.29.0       |

The two halves of the policy are not jointly satisfiable on this data. The
ceiling is lower than it looks: caniuse's global usage table sums to 96.6878%,
not 100%, so the matrix is at 93% of everything the dataset can account for.
Most of the missing usage is not exotic browsers — it is users on Chrome, Firefox
and iOS Safari releases that predate `@scope`:

```
chrome < 118           2.51%
firefox < 146          1.52%
ios_saf < 17.4         1.01%
and_uc (all versions)  0.68%
safari < 17.4          0.35%
```

Resolving this is a policy decision, not a tooling one. The options are: lower the
target, ship a fallback for the feature that costs the most usage (`@scope` is
the whole shortfall: drop it and the same intersection measures 95.6886%), or
accept a red gate until usage data catches up. `@scope` reached Firefox only in
146, so the number rises on its own with each refresh.

## Why it is computed this way

`cover 91%` on its own is not the policy and does not implement it: browserslist
would happily hand back a 91% set full of browsers with no `@scope`. So the
order is fixed —

1. start from every browser version browserslist knows about,
2. **intersect** across all required features (a version survives only if every
   feature is fully supported),
3. **then measure** the aggregate usage of what survived.

Coverage is the outcome, never the input.

A browser's floor is the oldest released version from which **no later release
regresses**, which is what a `>= version` query actually promises.

### What counts as "supported"

caniuse encodes a verdict in the first token of each cell (`y`, `a` partial, `n`,
`p` polyfill, `u` unknown) plus modifier flags (`x` needs a prefix, `d` behind a
flag). Only a plain `y` counts:

- `a` (partial) is rejected because no CSS fallback ships. A browser that
  implements part of `@scope` still renders some styles unscoped, which is worse
  than a browser we simply do not claim to support.
- `y x` is rejected because the build emits unprefixed CSS and unprefixed API
  calls, so prefix-only support would not run.

## Outputs

| File                                           | Purpose                                                                                                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`browser-matrix.json`](./browser-matrix.json) | Checked-in artifact: timestamp, data versions, required feature ids, per-browser minimum versions, browserslist query, measured coverage, excluded browsers. |
| `/.browserslistrc`                             | Generated at the repo root; the explicit `>=` floors every build tool reads. **Never hand-edit it** — rerun the report.                                      |

Stdout is the human-readable release compatibility report. The command **exits
non-zero** when measured coverage is below the target, listing the excluded
browsers and, for supported browsers, the usage lost below each floor.

## Usage

```sh
pnpm browser-matrix                          # report + regenerate both artifacts, gate the release
pnpm --filter @company/browser-matrix test   # unit tests
pnpm --filter @company/browser-matrix typecheck
```

`report.mjs` imports the TypeScript sources directly; Node strips the types at
load time (unflagged since Node 22.18), so there is no build step.

## Refresh cadence

Rerun `pnpm browser-matrix` and commit both artifacts:

- **quarterly**, as a scheduled chore — usage data and `@scope` adoption both
  move, and the gate only tells the truth about the data it was last run on;
- **before any release that raises minimum versions**, because a raised floor
  silently drops users;
- whenever `caniuse-lite` or `browserslist` is bumped in the root
  `pnpm-workspace.yaml` catalog;
- whenever `src/required-features.ts` changes.

Refreshing means bumping `caniuse-lite` in the catalog first
(`pnpm up caniuse-lite@latest -w`) — the version is pinned, so the report is
reproducible but goes stale on purpose rather than drifting under you.

Review, on each refresh: the measured coverage, any floor that moved, and any
browser that entered or left the excluded list.

## Changing the required features

Add to `REQUIRED_FEATURES` only when framework code depends on the feature and
no fallback ships — the matrix is an intersection, so every addition can only
raise floors and lower coverage.

Not every API the framework relies on has a caniuse id. `CONSIDERED_FEATURES`
records the ones that were evaluated and left out (including
`Object.hasOwn` and the ES2023 baseline, which caniuse cannot express and which
are enforced by `tsconfig` `target: ES2023` instead). The tests assert those
notes stay accurate: an id claimed to be missing that suddenly resolves fails the
suite, so a refresh cannot quietly invalidate the reasoning.
