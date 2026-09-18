/**
 * Shell-owned live state and its transitions. UI subscribes *per field*, so a
 * theme change never notifies a consumer that only reads the user, and each
 * change is classified because a theme change must not reload data while an
 * identity or group change must retire session-dependent work first.
 *
 * Data for rendering, deliberately not an authorization API.
 */

import {
  arrayEqual,
  KeyedListeners,
  shallowEqual,
  type ShellState,
  type ShellTheme,
  type ShellTransition,
  type ShellUser,
  type Unsubscribe,
} from '@company/mfe-core'

export type ShellStateField = keyof ShellState

const FIELDS: readonly ShellStateField[] = ['user', 'groups', 'theme']

export interface ShellStatePatch {
  readonly user?: ShellUser | null
  readonly groups?: readonly string[]
  readonly theme?: ShellTheme
}

/** What changed, and what the host must do about it. */
export interface ShellStateChange {
  readonly changed: readonly ShellStateField[]
  readonly transitions: readonly ShellTransition[]
  readonly previous: ShellState
  readonly next: ShellState
}

export type ShellStateObserver = (change: ShellStateChange) => void

/** A reordering is a no-op; adding or removing a group is a real permission change. */
function sameGroupSet(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  const left = new Set(a)
  for (const group of b) {
    if (!left.has(group)) return false
  }
  return true
}

function sameUser(a: ShellUser | null, b: ShellUser | null): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  return shallowEqual(a, b)
}

/** A different principal, account or tenant retires session state; a new display name does not. */
function classifyIdentityChange(
  previous: ShellUser | null,
  next: ShellUser | null,
): ShellTransition | null {
  if (previous === null && next === null) return null
  if (previous === null) return { kind: 'identity', reason: 'login' }
  if (next === null) return { kind: 'identity', reason: 'logout' }
  if (previous.id !== next.id) return { kind: 'identity', reason: 'login' }
  if (previous.tenantId !== next.tenantId) return { kind: 'identity', reason: 'tenant' }
  if (previous.accountId !== next.accountId) return { kind: 'identity', reason: 'account' }
  return null
}

export class ShellStateStore {
  #state: ShellState
  readonly #fieldListeners = new KeyedListeners()
  readonly #observers = new Set<ShellStateObserver>()

  constructor(initial: ShellState) {
    this.#state = Object.freeze({
      user: initial.user,
      groups: Object.freeze([...initial.groups]),
      theme: initial.theme,
    })
  }

  /** The current coherent snapshot. Route callbacks read this at invocation time. */
  readonly getSnapshot = (): ShellState => this.#state

  readonly getUser = (): ShellUser | null => this.#state.user
  readonly getGroups = (): readonly string[] => this.#state.groups
  readonly getTheme = (): ShellTheme => this.#state.theme

  /** One field only, with a stable reference React can hold across renders. */
  readonly subscribeToField = (field: ShellStateField, listener: () => void): Unsubscribe =>
    this.#fieldListeners.subscribe(field, listener)

  /** Host-side observer of classified transitions; not a UI subscription. */
  observeTransitions(observer: ShellStateObserver): Unsubscribe {
    this.#observers.add(observer)
    return () => {
      this.#observers.delete(observer)
    }
  }

  fieldListenerCount(field: ShellStateField): number {
    return this.#fieldListeners.listenerCount(field)
  }

  /**
   * Replaces the snapshot only when state actually changed, preserving
   * unchanged field references. Observers run before field listeners, so the
   * host retires obsolete work before new-session state reaches the UI.
   */
  apply(
    patch: ShellStatePatch,
    options: { readonly tokenRefresh?: boolean } = {},
  ): ShellStateChange {
    const previous = this.#state

    const nextUser = patch.user === undefined ? previous.user : patch.user
    const nextTheme = patch.theme === undefined ? previous.theme : patch.theme
    const nextGroups =
      patch.groups === undefined
        ? previous.groups
        : arrayEqual(previous.groups, patch.groups)
          ? previous.groups
          : Object.freeze([...patch.groups])

    const changed: ShellStateField[] = []
    if (!sameUser(previous.user, nextUser)) changed.push('user')
    if (previous.groups !== nextGroups) changed.push('groups')
    if (previous.theme !== nextTheme) changed.push('theme')

    if (changed.length === 0 && !options.tokenRefresh) {
      return { changed: [], transitions: [], previous, next: previous }
    }

    const transitions: ShellTransition[] = []
    if (options.tokenRefresh) transitions.push({ kind: 'token-refresh' })

    const identity = classifyIdentityChange(previous.user, nextUser)
    if (identity) transitions.push(identity)

    // A reordered but identical group set is not a permission change, so it
    // must not retire anything.
    if (previous.groups !== nextGroups && !sameGroupSet(previous.groups, nextGroups)) {
      transitions.push({ kind: 'groups' })
    }

    if (previous.theme !== nextTheme) transitions.push({ kind: 'theme' })

    this.#state = Object.freeze({ user: nextUser, groups: nextGroups, theme: nextTheme })

    const change: ShellStateChange = { changed, transitions, previous, next: this.#state }

    for (const observer of [...this.#observers]) observer(change)
    for (const field of changed) this.#fieldListeners.notify(field)

    return change
  }

  dispose(): void {
    this.#fieldListeners.clear()
    this.#observers.clear()
  }
}

/** Whether a set of transitions requires retiring session-dependent work. */
export function requiresSessionRetirement(transitions: readonly ShellTransition[]): boolean {
  return transitions.some(
    transition => transition.kind === 'identity' || transition.kind === 'groups',
  )
}

export { FIELDS as SHELL_STATE_FIELDS }
