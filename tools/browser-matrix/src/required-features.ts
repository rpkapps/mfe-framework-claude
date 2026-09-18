/**
 * The native feature floor of the framework.
 *
 * Every id here is a caniuse feature id and is verified against the pinned
 * `caniuse-lite` by `required-features.test.ts`. The matrix is the intersection
 * of these features, so adding one can only ever raise minimum versions — add a
 * feature only when framework code actually depends on it and no fallback
 * ships.
 */

export interface RequiredFeature {
  /** caniuse feature id, as used by `browserslist`'s `supports` query. */
  readonly id: string
  /** Why the framework cannot run without it. */
  readonly reason: string
}

export const REQUIRED_FEATURES: readonly RequiredFeature[] = [
  {
    // Style isolation is native `@scope` with no CSS fallback shipped, so a
    // browser without it renders every MFE's styles unscoped. This is the
    // binding constraint of the whole matrix.
    id: 'css-cascade-scope',
    reason: 'Style isolation is native CSS @scope and no fallback is shipped.',
  },
  {
    // packages/mfe-core/src/lifecycle.ts: every mount attempt carries an
    // AbortSignal, and disposal aborts it. There is no polyfill in the runtime
    // bundle.
    id: 'abortcontroller',
    reason: 'AbortController/AbortSignal drive the mount lifecycle in mfe-core.',
  },
]

export const REQUIRED_FEATURE_IDS: readonly string[] = REQUIRED_FEATURES.map(feature => feature.id)

export interface ConsideredFeature {
  readonly id: string
  /** Whether the id exists in the pinned caniuse-lite at all. */
  readonly resolves: boolean
  /** Why it is not in {@link REQUIRED_FEATURES}. */
  readonly note: string
}

/**
 * Features that were evaluated for the floor and deliberately left out. Kept in
 * the source (and asserted in tests) so a future refresh does not silently
 * re-litigate them.
 */
export const CONSIDERED_FEATURES: readonly ConsideredFeature[] = [
  {
    id: 'mdn-api_abortsignal_reason',
    resolves: false,
    note:
      'No such id in caniuse-lite: it ships caniuse features only, and the handful of ' +
      'mdn-* ids it does carry are CSS ones. `signal.reason` shipped in the same engine ' +
      'releases as the AbortSignal support already required, far below the @scope floor.',
  },
  {
    id: 'mdn-javascript_builtins_object_hasown',
    resolves: false,
    note: 'No such id in caniuse-lite. See `object-hasown`.',
  },
  {
    id: 'object-hasown',
    resolves: false,
    note:
      'No caniuse id covers Object.hasOwn (used by mfe-core/src/observable.ts). It is ES2022 ' +
      '(Chrome 93 / Firefox 92 / Safari 15.4) and therefore implied by every browser that ' +
      'clears the @scope floor; it is enforced at build time by tsconfig `target: ES2023`.',
  },
  {
    id: 'es2023',
    resolves: false,
    note:
      'caniuse has no ES-version id newer than `es6`, so the ES2023 baseline cannot be ' +
      'expressed as a feature filter. It is enforced by tsconfig `target: ES2023` plus the ' +
      '@scope floor, which is several years newer than any ES2023-complete engine.',
  },
  {
    id: 'broadcastchannel',
    resolves: true,
    note:
      'Resolves, but no framework package uses BroadcastChannel today. Requiring an unused ' +
      'feature could only tighten the matrix for nothing. Move it into REQUIRED_FEATURES the ' +
      'day cross-tab messaging ships.',
  },
]
