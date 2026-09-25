/**
 * Scoped action registration, where the host page is one more scope so a palette renders
 * one list instead of merging a snapshot with a hard-coded one. The performance
 * contract is the interesting part: replacing `execute`/`canExecute` closure identity must
 * not change the public snapshot, and updating one action must not re-evaluate any other.
 *
 * An action's keyboard shortcut lives here too rather than in a registry of its own, because
 * a mounted App renders in its own root and cannot reach a registry the host provides through
 * its framework's context; the host listens for keys once and hands each one to
 * `handleKeyDown`, which runs the action through the same path the palette does.
 */

import {
  ACTION_EFFECTS,
  actionEntryEqual,
  createMfeError,
  DEFAULT_ACTION_PLACEMENTS,
  HOST_SCOPE,
  isRecord,
  toMfeError,
  withoutUndefined,
  type ActionEntry,
  type ActionInputSchema,
  type ActionRegistration,
  type DefinitionKind,
  type JsonSchemaObject,
  type MfeError,
  type MfeErrorDetails,
  type Unsubscribe,
} from '@company/mfe-core'

import type { DiagnosticsHub } from '../diagnostics.ts'
import { SnapshotSource } from '../observable.ts'
import {
  ActionExecutor,
  decide,
  effectOf,
  type ActionApprovalPolicy,
  type ActionApprover,
  type ActionCall,
  type ActionDenialNotifier,
  type ActionExecutionResult,
} from './action-executor.ts'
import {
  chordFromEvent,
  firesInsideFields,
  isApplePlatform,
  isEditableElement,
  matchSequence,
  parseShortcut,
  SEQUENCE_TIMEOUT_MS,
  shortcutsOverlap,
  type ParsedShortcut,
  type PressedChord,
  type ShortcutCandidate,
} from './shortcut.ts'
import {
  canCoexist,
  HOST_PAGE_SCOPE,
  isLive,
  mountShortcutScope,
  type ShortcutScope,
} from './shortcut-scope.ts'

const VALID_PLACEMENTS = new Set<string>(DEFAULT_ACTION_PLACEMENTS)
const VALID_EFFECTS = new Set<string>(ACTION_EFFECTS)

/** Restricted so `<definitionId>:<name>` stays unambiguous. */
const ACTION_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9-]*$/

/** Every registration failure this module raises carries the same code. */
function fail(id: string, details: Omit<MfeErrorDetails, 'code' | 'id'>): MfeError {
  return createMfeError({
    code: 'action/duplicate-name',
    id,
    ...details,
  })
}

/** Who registered an action; a mount's context already carries every field. */
export interface ActionOwner {
  readonly definitionId: string
  readonly mountToken: string
  readonly kind: DefinitionKind
  /** The App's URL boundary, which decides when its shortcuts fire; a Widget's is never read. */
  readonly basePath: string
}

export interface ActionRegistrationHandle {
  /** Applies the latest committed registration after a React commit. */
  update(registration: ActionRegistration): void
  remove(): void
  /** Follows a change of `name`. */
  readonly qualifiedId: string
}

/** What a key press did. Only `pending` and `matched` prevent the event's default. */
export type ShortcutDispatchResult =
  | { readonly status: 'unmatched' }
  /** The keys so far begin a sequence; the next one decides. */
  | { readonly status: 'pending' }
  /** More than one live registration claims these keys, so none of them ran. */
  | { readonly status: 'ambiguous'; readonly actionIds: readonly string[] }
  | {
      readonly status: 'matched'
      readonly actionId: string
      readonly execution: Promise<ActionExecutionResult>
    }

interface RegisteredAction {
  qualifiedId: string
  readonly definitionId: string
  /** The mount token that owns it, or the reserved host scope. */
  readonly scopeToken: string
  /** Where its shortcut may fire, resolved once from its owner. */
  readonly shortcutScope: ShortcutScope
  registration: ActionRegistration
  /** The registration's validated shortcut, whether or not it may fire. */
  declared: ParsedShortcut | undefined
  /**
   * `declared` unless it is refused. Kept rather than derived, because every key press and entry
   * build reads it and deriving it scans the host page's shortcuts; it changes only when
   * `declared` or the host page's shortcuts do, and both paths recompute it.
   */
  usable: ParsedShortcut | undefined
  /** The registration's schemas as JSON Schema, converted only when either one's identity changes. */
  schemas: ActionSchemas
  /** The last published entry; reused when nothing visible changed. */
  entry: ActionEntry
}

interface ActionSchemas {
  readonly input: ActionRegistration['inputSchema']
  readonly output: ActionRegistration['outputSchema']
  readonly inputSchema?: JsonSchemaObject
  readonly outputSchema?: JsonSchemaObject
}

/** An action before its first entry is built from it. */
type ActionShape = Omit<RegisteredAction, 'entry'>

export interface ActionRegistryOptions {
  readonly diagnostics?: DiagnosticsHub
  readonly notifyDenial?: ActionDenialNotifier
  /**
   * Where the page is, which decides whose shortcuts fire: an App's only while this pathname is
   * inside its boundary. Omitted, only the host page's shortcuts fire.
   */
  readonly readPathname?: () => string
  /** The host's rule over every agent call, on top of what each action declares. */
  readonly approvalPolicy?: ActionApprovalPolicy
}

const UNMATCHED: ShortcutDispatchResult = Object.freeze({ status: 'unmatched' })

/**
 * Actions are stored per scope, so a name may repeat across mounts but never inside one
 * and a mount's disposal cannot take the host page's with it.
 */
export class ActionRegistry {
  readonly #byScope = new Map<string, Map<string, RegisteredAction>>()
  readonly #snapshot = new SnapshotSource<readonly ActionEntry[]>(Object.freeze([]))
  readonly #options: ActionRegistryOptions
  readonly #executor: ActionExecutor<RegisteredAction>
  /** Read once: what `mod` means cannot change while the page is open. */
  readonly #apple = isApplePlatform()
  /** The chords of a sequence typed so far, dropped when the next one is too late. */
  #pressed: readonly PressedChord[] = []
  #pressedAt = 0
  #approver: ActionApprover | undefined

  constructor(options: ActionRegistryOptions = {}) {
    this.#options = options
    this.#executor = new ActionExecutor({
      diagnostics: options.diagnostics,
      notifyDenial: options.notifyDenial,
      // Refresh the denied entry, so the palette shows the state the notice describes.
      onDenied: action => {
        if (this.#refreshEntry(action)) this.#publish()
      },
      approvalPolicy: options.approvalPolicy,
      approver: () => this.#approver,
      isLive: action =>
        this.#byScope.get(action.scopeToken)?.get(action.registration.name) === action,
    })
  }

  /** Stable references for `useSyncExternalStore`. */
  readonly getSnapshot = (): readonly ActionEntry[] => this.#snapshot.getSnapshot()
  readonly subscribe = (listener: () => void): Unsubscribe => this.#snapshot.subscribe(listener)

  get size(): number {
    let total = 0
    for (const actions of this.#byScope.values()) total += actions.size
    return total
  }

  /**
   * Duplicate local names within a mount are rejected rather than overwritten; the same name in
   * another mount is fine because the runtime qualifies it.
   */
  register<Input extends ActionInputSchema, Output>(
    owner: ActionOwner,
    registration: ActionRegistration<Input, Output>,
  ): ActionRegistrationHandle {
    const { definitionId, mountToken } = owner
    if (definitionId === HOST_SCOPE || mountToken === HOST_SCOPE) {
      throw fail(definitionId, {
        operation: `register action '${registration.name}'`,
        expected: 'a definition id and the mount token the runtime issued for it',
        observed: `the reserved host scope ${HOST_SCOPE}`,
        repair:
          'Call registerHost instead. It is the one way into the host scope, so a host action and a mount action can never be confused for each other.',
      })
    }

    return this.#add(
      {
        definitionId,
        scopeToken: mountToken,
        shortcutScope: mountShortcutScope(owner.kind, owner.basePath),
      },
      registration,
    )
  }

  /**
   * A host has no definition id and no mount token, and a made-up token cannot be told
   * from a real mount's, which would put the host's actions at the mercy of
   * `removeMount`.
   */
  registerHost<Input extends ActionInputSchema, Output>(
    registration: ActionRegistration<Input, Output>,
  ): ActionRegistrationHandle {
    return this.#add(
      { definitionId: HOST_SCOPE, scopeToken: HOST_SCOPE, shortcutScope: HOST_PAGE_SCOPE },
      registration,
    )
  }

  /** A mount's actions, and so its shortcuts, go with it. */
  removeMount(mountToken: string): void {
    if (!this.#byScope.delete(mountToken)) return
    // Handed the host scope's token, the host page's shortcuts went too, which frees any keys a
    // container was refused.
    if (mountToken === HOST_SCOPE) this.#refreshContainerShortcuts()
    this.#publish()
  }

  /**
   * The palette calls this when it opens; no other path evaluates all actions, because updating
   * one must not re-evaluate the rest.
   */
  evaluateAll(): void {
    let changed = false
    for (const action of this.#allActions()) {
      if (this.#refreshEntry(action)) changed = true
    }
    if (changed) this.#publish()
  }

  /**
   * The surface that asks the user about an agent's call: the chat's card. One at a time; the
   * returned function removes it only while it is still the one set. Without one, a call that
   * needs approval is denied rather than run.
   */
  setApprover(approver: ActionApprover): Unsubscribe {
    this.#approver = approver
    return () => {
      if (this.#approver === approver) this.#approver = undefined
    }
  }

  /** Runs through the executor's steps; `call` says who asked, which a key press does itself. */
  async execute(qualifiedId: string, call: ActionCall): Promise<ActionExecutionResult> {
    const action = this.#find(qualifiedId)
    if (!action) {
      const error = fail(qualifiedId.split(':')[0] ?? qualifiedId, {
        operation: `execute action '${qualifiedId}'`,
        expected: 'a live registration, from a mount or from the host page',
        observed: 'no registration, so whoever registered it has gone away',
        repair:
          'Re-open the surface that registers this action. A mount action goes with its mount, and a host action with the chrome that registered it.',
      })
      this.#options.diagnostics?.report(error, { severity: 'warning' })
      return { status: 'unavailable', error }
    }

    return await this.#executor.run(action, call)
  }

  /**
   * Reads one `keydown` for the host's single document listener. A match runs through the path
   * `execute` takes, so `canExecute` still decides and a denial still reaches the user.
   *
   * Whose shortcuts are live: the host page's always, and an App's while the page is inside its
   * boundary — nested Apps both, since the page is inside both. A key that more than one of
   * those claims runs none of them; registration already reported the collision.
   */
  handleKeyDown(event: KeyboardEvent): ShortcutDispatchResult {
    if (event.defaultPrevented) return UNMATCHED
    const pressed = chordFromEvent(event)
    if (pressed === null) return UNMATCHED

    // React Aria's Autocomplete re-dispatches a field's keydown onto the option it has virtually
    // focused, so `event.target` is not a field although DOM focus never left one; the focused
    // element is the honest answer. A letter typed there stays typed, and is not remembered as
    // the start of a sequence either.
    const inField = isEditableElement(event.target) || isEditableElement(activeElementOf(event))
    if (inField && !pressed.ctrl && !pressed.alt && !pressed.meta) {
      this.#pressed = []
      return UNMATCHED
    }

    const now = Date.now()
    const earlier = now - this.#pressedAt > SEQUENCE_TIMEOUT_MS ? [] : this.#pressed
    this.#pressedAt = now

    const candidates = this.#liveShortcuts(inField)
    let sequence = [...earlier, pressed]
    let match = matchSequence(sequence, candidates, this.#apple)
    // A key that continues nothing may still begin something: `g g r` is `g r` after a stray `g`.
    if (match.kind === 'none' && sequence.length > 1) {
      sequence = [pressed]
      match = matchSequence(sequence, candidates, this.#apple)
    }

    this.#pressed = match.kind === 'pending' ? sequence : []
    switch (match.kind) {
      case 'none':
        return UNMATCHED
      case 'pending':
        event.preventDefault()
        return { status: 'pending' }
      case 'ambiguous':
        return {
          status: 'ambiguous',
          actionIds: match.targets.map(action => action.qualifiedId),
        }
      case 'complete':
        event.preventDefault()
        return {
          status: 'matched',
          actionId: match.target.qualifiedId,
          execution: this.#executor.run(match.target, { caller: 'shortcut' }),
        }
    }
  }

  dispose(): void {
    this.#byScope.clear()
    this.#pressed = []
    this.#approver = undefined
    this.#snapshot.dispose()
  }

  #add(
    owner: Pick<RegisteredAction, 'definitionId' | 'scopeToken' | 'shortcutScope'>,
    registration: ActionRegistration,
  ): ActionRegistrationHandle {
    const { definitionId, scopeToken } = owner
    const declared = this.#assertValid(definitionId, registration)
    const schemas = describeSchemas(definitionId, registration, undefined)

    const actions = this.#scopeActions(scopeToken)
    if (actions.has(registration.name)) {
      throw this.#duplicateNameError(definitionId, registration.name)
    }

    const qualifiedId = `${definitionId}:${registration.name}`
    const usable = this.#usableShortcut(owner.shortcutScope, declared)
    const unpublished = { ...owner, qualifiedId, registration, declared, usable, schemas }
    const action: RegisteredAction = { ...unpublished, entry: this.#buildEntry(unpublished) }

    actions.set(registration.name, action)
    if (declared) this.#afterShortcutChange(action)
    this.#publish()

    let active = true
    return {
      get qualifiedId() {
        return action.qualifiedId
      },
      update: next => {
        if (active) this.#update(action, next)
      },
      remove: () => {
        if (!active) return
        active = false
        const owned = this.#byScope.get(scopeToken)
        if (owned) {
          owned.delete(action.registration.name)
          if (owned.size === 0) this.#byScope.delete(scopeToken)
        }
        // A host shortcut going away frees the keys for a container that was refused them.
        if (action.shortcutScope.kind === 'reserved' && action.declared) {
          this.#refreshContainerShortcuts()
        }
        this.#publish()
      },
    }
  }

  #update(action: RegisteredAction, next: ActionRegistration): void {
    const actions = this.#scopeActions(action.scopeToken)
    const shortcutChanged = next.shortcut !== action.registration.shortcut

    // Changing `name` replaces the local registration, with the same validation as a fresh
    // register. Otherwise the shortcut is parsed only when it changed, because this runs after
    // every commit of the component that registered it.
    let { declared } = action
    // Before anything changes, so a schema that cannot be described leaves the action as it was.
    const schemas = describeSchemas(action.definitionId, next, action.schemas)
    if (next.name !== action.registration.name) {
      declared = this.#assertValid(action.definitionId, next)
      if (actions.has(next.name)) {
        throw this.#duplicateNameError(action.definitionId, next.name)
      }
      actions.delete(action.registration.name)
      actions.set(next.name, action)
      action.qualifiedId = `${action.definitionId}:${next.name}`
    } else if (shortcutChanged) {
      declared = this.#parseDeclared(action.definitionId, next)
    }
    action.registration = next
    action.declared = declared
    action.schemas = schemas
    if (shortcutChanged) action.usable = this.#usableShortcut(action.shortcutScope, declared)

    let changed = this.#refreshEntry(action)
    if (shortcutChanged && this.#afterShortcutChange(action)) changed = true
    if (changed) this.#publish()
  }

  /**
   * Reported once, when a shortcut is declared or changes, rather than on every key press: a
   * Widget's is refused, a container's that the host page uses is refused, and one that another
   * live registration could be pressed for at the same time collides with it. A change to the
   * host page's shortcuts can claim or free a container's keys; returns whether that changed an
   * entry, so the caller publishes once.
   */
  #afterShortcutChange(action: RegisteredAction): boolean {
    const { declared, shortcutScope } = action
    if (declared) {
      const refusal = this.#shortcutRefusal(shortcutScope, declared)
      if (refusal === undefined) this.#reportCollisions(action, declared)
      else this.#reportRefusal(action, declared, refusal)
    }
    return shortcutScope.kind === 'reserved' && this.#refreshContainerShortcuts()
  }

  /**
   * The host page's shortcuts changed, so a container's may have been claimed or freed. Returns
   * whether any entry changed; the caller publishes.
   */
  #refreshContainerShortcuts(): boolean {
    let changed = false
    for (const action of this.#allActions()) {
      const { declared, shortcutScope } = action
      if (shortcutScope.kind === 'reserved' || !declared) continue
      const refusal = this.#shortcutRefusal(shortcutScope, declared)
      const had = action.usable
      action.usable = refusal === undefined ? declared : undefined
      if (!this.#refreshEntry(action)) continue
      changed = true
      if (had !== undefined && refusal !== undefined) {
        this.#reportRefusal(action, declared, refusal)
      }
    }
    return changed
  }

  /**
   * Why a declared shortcut may not fire. A Widget is an embedded fragment and does not own the
   * page's keys, as it does not own its URL; the host page's keys are the one set every page
   * has, so a container cannot take them, nor begin or extend one of them. The host scope's own
   * actions are the only ones read, so a check costs the host page's count, not everyone's.
   */
  #shortcutRefusal(scope: ShortcutScope, declared: ParsedShortcut): ShortcutRefusal | undefined {
    if (scope.kind === 'reserved') return undefined
    if (scope.kind === 'never') return { reason: 'widget' }

    for (const host of this.#byScope.get(HOST_SCOPE)?.values() ?? []) {
      if (host.declared && shortcutsOverlap(declared, host.declared, this.#apple)) {
        return { reason: 'reserved', by: host }
      }
    }
    return undefined
  }

  #usableShortcut(
    scope: ShortcutScope,
    declared: ParsedShortcut | undefined,
  ): ParsedShortcut | undefined {
    if (!declared) return undefined
    return this.#shortcutRefusal(scope, declared) === undefined ? declared : undefined
  }

  /** Actions whose shortcut can fire right now, from the host page and from every active App. */
  #liveShortcuts(inField: boolean): ShortcutCandidate<RegisteredAction>[] {
    const pathname = readOnce(() => this.#options.readPathname?.())
    const live: ShortcutCandidate<RegisteredAction>[] = []

    for (const action of this.#allActions()) {
      const shortcut = action.usable
      // A chord typed into a field is text, unless every step of it holds a modifier.
      if (!shortcut || (inField && !firesInsideFields(shortcut))) continue
      if (isLive(action.shortcutScope, pathname)) live.push({ shortcut, target: action })
    }
    return live
  }

  #reportCollisions(action: RegisteredAction, declared: ParsedShortcut): void {
    const rivals: RegisteredAction[] = []
    for (const other of this.#allActions()) {
      const theirs = other.usable
      if (other === action || !theirs) continue
      if (!canCoexist(action.shortcutScope, other.shortcutScope)) continue
      if (shortcutsOverlap(declared, theirs, this.#apple)) rivals.push(other)
    }
    if (rivals.length === 0) return

    this.#options.diagnostics?.report(
      fail(action.definitionId, {
        operation: `register the shortcut '${declared.source}' for action '${action.registration.name}'`,
        expected: 'keys no other live action can be pressed for at the same time',
        observed: `${rivals.map(rival => `'${rival.qualifiedId}' (${rival.registration.shortcut ?? ''})`).join(', ')} already claims them`,
        repair:
          'Give one of them different keys. Neither runs while both are registered, because letting whichever registered first win would depend on mount order.',
      }),
      { severity: 'warning' },
    )
  }

  #reportRefusal(
    action: RegisteredAction,
    declared: ParsedShortcut,
    refusal: ShortcutRefusal,
  ): void {
    const operation = `register the shortcut '${declared.source}' for action '${action.registration.name}'`
    const error =
      refusal.reason === 'widget'
        ? fail(action.definitionId, {
            operation,
            expected: 'a shortcut from an App or the host page',
            observed: 'a shortcut from a Widget, which does not own the page’s keys',
            repair:
              'Drop the shortcut; the action stays in the palette without it. If the keys matter, emit an event and let the App that places the Widget register the shortcut.',
          })
        : fail(action.definitionId, {
            operation,
            expected: 'keys the host page does not use',
            observed: `the host page’s '${refusal.by.qualifiedId}' (${refusal.by.declared?.source ?? ''}) uses them`,
            repair:
              'Choose other keys. The action stays in the palette, but its shortcut is ignored while the host page reserves these.',
          })
    this.#options.diagnostics?.report(error, { severity: 'warning' })
  }

  #scopeActions(scopeToken: string): Map<string, RegisteredAction> {
    let actions = this.#byScope.get(scopeToken)
    if (!actions) {
      actions = new Map()
      this.#byScope.set(scopeToken, actions)
    }
    return actions
  }

  *#allActions(): Generator<RegisteredAction> {
    for (const actions of this.#byScope.values()) yield* actions.values()
  }

  #find(qualifiedId: string): RegisteredAction | undefined {
    for (const action of this.#allActions()) {
      if (action.qualifiedId === qualifiedId) return action
    }
    return undefined
  }

  #buildEntry(action: ActionShape): ActionEntry {
    const { definitionId, registration, usable, schemas } = action
    return Object.freeze({
      id: action.qualifiedId,
      definitionId,
      name: registration.name,
      label: registration.label,
      placements: registration.placements ?? DEFAULT_ACTION_PLACEMENTS,
      effect: effectOf(registration),
      followUp: registration.followUp ?? true,
      decision: decide(definitionId, registration, this.#options.diagnostics),
      ...withoutUndefined({
        description: registration.description,
        inputSchema: schemas.inputSchema,
        outputSchema: schemas.outputSchema,
        shortcut: usable?.source,
      }),
    })
  }

  /**
   * An identical visible result keeps the existing entry reference, so the palette's snapshot does
   * not change and no subscriber re-renders. Returns whether the entry changed.
   */
  #refreshEntry(action: RegisteredAction): boolean {
    const next = this.#buildEntry(action)
    if (actionEntryEqual(action.entry, next)) return false
    action.entry = next
    return true
  }

  #publish(): void {
    this.#snapshot.set(Object.freeze([...this.#allActions()].map(action => action.entry)))
  }

  #duplicateNameError(definitionId: string, name: string): MfeError {
    return fail(definitionId, {
      operation: `register action '${name}'`,
      expected: 'one registration per action name within a mount',
      observed: `a second registration of '${name}' in the same mount`,
      repair:
        'Rename one of the actions. Duplicate local names are rejected rather than overwritten, so neither registration silently wins.',
    })
  }

  /** Returns the parsed shortcut, so a valid registration is parsed exactly once. */
  #assertValid(definitionId: string, registration: ActionRegistration): ParsedShortcut | undefined {
    const { name, label } = registration
    if (!ACTION_NAME_PATTERN.test(name)) {
      throw fail(definitionId, {
        operation: 'register action',
        expected:
          'a name of letters, digits and hyphens starting with a letter (for example "refresh")',
        observed: name === '' ? 'an empty string' : JSON.stringify(name),
        repair:
          'Rename the action. The runtime qualifies it internally as <definitionId>:<name>, which needs an unambiguous local name.',
      })
    }

    if (label === '') {
      throw fail(definitionId, {
        operation: `register action '${name}'`,
        expected: 'a non-empty label',
        observed: 'an empty string',
        repair: 'Add a human-readable label; the palette has nothing to render without one.',
      })
    }

    for (const placement of registration.placements ?? DEFAULT_ACTION_PLACEMENTS) {
      if (VALID_PLACEMENTS.has(placement)) continue
      throw fail(definitionId, {
        operation: `register action '${name}'`,
        expected: `a standardized placement (${[...VALID_PLACEMENTS].join(', ')})`,
        observed: JSON.stringify(placement),
        repair:
          'Use one of the standardized placements. Future placements add placement records to this model.',
      })
    }

    const { effect } = registration
    if (effect !== undefined && !VALID_EFFECTS.has(effect)) {
      throw fail(definitionId, {
        operation: `register action '${name}'`,
        expected: `an effect (${[...VALID_EFFECTS].join(', ')})`,
        observed: JSON.stringify(effect),
        repair: 'Declare what a run can change, or leave effect out to count it as a write.',
      })
    }

    return this.#parseDeclared(definitionId, registration)
  }

  #parseDeclared(
    definitionId: string,
    registration: ActionRegistration,
  ): ParsedShortcut | undefined {
    if (registration.shortcut === undefined) return undefined
    const parsed = parseShortcut(registration.shortcut)
    if (parsed.ok) return parsed.shortcut

    throw fail(definitionId, {
      operation: `register action '${registration.name}'`,
      expected:
        'a shortcut such as "mod+s" — modifiers (mod, ctrl, alt, shift, meta) and one key joined by + — or a sequence of them separated by spaces, such as "g r"',
      observed: `${JSON.stringify(registration.shortcut)}: ${parsed.problem}`,
      repair: 'Fix the shortcut, or remove it; the action works from the palette without one.',
    })
  }
}

/**
 * The registration's schemas as JSON Schema, which is what an agent's tool list sends. Converted
 * by each schema's own `toJSONSchema`, so a container's schema is read by the Zod that made it,
 * and only when its identity changed since `previous`. A schema JSON Schema cannot express (a
 * date, a transform's output) is refused at registration, since the agent could not call it.
 */
function describeSchemas(
  definitionId: string,
  registration: ActionRegistration,
  previous: ActionSchemas | undefined,
): ActionSchemas {
  const { inputSchema: input, outputSchema: output } = registration
  if (previous && previous.input === input && previous.output === output) return previous

  if (input !== undefined && !isRecord(input.shape)) {
    throw fail(definitionId, {
      operation: `register action '${registration.name}'`,
      expected: 'an inputSchema made with z.object',
      observed: 'a schema that is not an object schema',
      repair:
        'Wrap the values in z.object({ … }). A call takes named values, as a tool’s arguments are.',
    })
  }

  const describe = (
    schema: NonNullable<ActionRegistration['outputSchema']>,
    field: 'inputSchema' | 'outputSchema',
  ): JsonSchemaObject => {
    try {
      const { $schema: _dialect, ...described } = schema.toJSONSchema({
        io: field === 'inputSchema' ? 'input' : 'output',
      }) as JsonSchemaObject
      return described
    } catch (error) {
      throw toMfeError(error, {
        code: 'action/duplicate-name',
        id: definitionId,
        operation: `describe the ${field} of action '${registration.name}' as JSON Schema`,
        repair: `Use only what JSON Schema can express in the ${field}: no dates, functions or transforms.`,
      })
    }
  }

  const inputSchema =
    previous && previous.input === input
      ? previous.inputSchema
      : input && describe(input, 'inputSchema')
  const outputSchema =
    previous && previous.output === output
      ? previous.outputSchema
      : output && describe(output, 'outputSchema')
  return { input, output, ...withoutUndefined({ inputSchema, outputSchema }) }
}

type ShortcutRefusal =
  { readonly reason: 'widget' } | { readonly reason: 'reserved'; readonly by: RegisteredAction }

/** Reads on the first call only, so a key press that meets no App never asks where the page is. */
function readOnce<T>(read: () => T): () => T {
  let cell: { readonly value: T } | undefined
  return () => (cell ??= { value: read() }).value
}

function activeElementOf(event: KeyboardEvent): Element | null {
  const { target } = event
  const owner = typeof Node !== 'undefined' && target instanceof Node ? target.ownerDocument : null
  const view = owner ?? (typeof document === 'undefined' ? null : document)
  return view?.activeElement ?? null
}
