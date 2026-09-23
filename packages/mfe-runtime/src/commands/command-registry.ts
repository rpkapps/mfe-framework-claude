/**
 * Scoped command registration, where the host page is one more scope so a palette renders
 * one list instead of merging a snapshot with a hard-coded one. The performance
 * contract is the interesting part: replacing `execute`/`canExecute` closure identity must
 * not change the public snapshot, and updating one command must not re-evaluate any other.
 *
 * A command's keyboard shortcut lives here too rather than in a registry of its own, because
 * a mounted App renders in its own root and cannot reach a registry the host provides through
 * its framework's context; the host listens for keys once and hands each one to
 * `handleKeyDown`, which runs the command through the same path the palette does.
 */

import {
  allow,
  commandEntryEqual,
  createMfeError,
  HOST_SCOPE,
  toMfeError,
  type CommandEntry,
  type CommandPlacement,
  type CommandRegistration,
  type Decision,
  type DefinitionKind,
  type MfeError,
  type MfeErrorDetails,
  type Unsubscribe,
} from '@company/mfe-core'

import type { DiagnosticsHub } from '../diagnostics.ts'
import { SnapshotSource } from '../observable.ts'
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

const DEFAULT_PLACEMENTS: readonly CommandPlacement[] = Object.freeze(['command-palette'])
const VALID_PLACEMENTS = new Set<string>(DEFAULT_PLACEMENTS)

/** Restricted so `<definitionId>:<name>` stays unambiguous. */
const COMMAND_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9-]*$/

/** Every registration failure this module raises carries the same code. */
function fail(id: string, details: Omit<MfeErrorDetails, 'code' | 'id'>): MfeError {
  return createMfeError({
    code: 'command/duplicate-name',
    id,
    ...details,
  })
}

/** Who registered a command; a mount's context already carries every field. */
export interface CommandOwner {
  readonly definitionId: string
  readonly mountToken: string
  readonly kind: DefinitionKind
  /** The App's URL boundary, which decides when its shortcuts fire; a Widget's is never read. */
  readonly basePath: string
}

export interface CommandRegistrationHandle {
  /** Applies the latest committed registration after a React commit. */
  update(registration: CommandRegistration): void
  remove(): void
  readonly qualifiedId: string
}

export type CommandExecutionResult =
  | { readonly status: 'executed' }
  | { readonly status: 'denied'; readonly reason: string }
  | { readonly status: 'unavailable'; readonly error: MfeError }
  | { readonly status: 'failed'; readonly error: MfeError }

/** What a key press did. Only `pending` and `matched` prevent the event's default. */
export type ShortcutDispatchResult =
  | { readonly status: 'unmatched' }
  /** The keys so far begin a sequence; the next one decides. */
  | { readonly status: 'pending' }
  /** More than one live registration claims these keys, so none of them ran. */
  | { readonly status: 'ambiguous'; readonly commandIds: readonly string[] }
  | {
      readonly status: 'matched'
      readonly commandId: string
      readonly execution: Promise<CommandExecutionResult>
    }

/** How a denial reaches the user: the shell's normal notification surface. */
export type CommandDenialNotifier = (notice: {
  readonly commandId: string
  readonly label: string
  readonly reason: string
}) => void

interface RegisteredCommand {
  qualifiedId: string
  readonly definitionId: string
  /** The mount token that owns it, or the reserved host scope. */
  readonly scopeToken: string
  /** Where its shortcut may fire, resolved once from its owner. */
  readonly shortcutScope: ShortcutScope
  registration: CommandRegistration
  /** The registration's validated shortcut, whether or not it may fire. */
  declared: ParsedShortcut | undefined
  /**
   * `declared` unless it is refused. Kept rather than derived, because every key press and entry
   * build reads it and deriving it scans the host page's shortcuts; it changes only when
   * `declared` or the host page's shortcuts do, and both paths recompute it.
   */
  usable: ParsedShortcut | undefined
  /** The last published entry; reused when nothing visible changed. */
  entry: CommandEntry
}

/** A command before its first entry is built from it. */
type CommandShape = Omit<RegisteredCommand, 'entry'>

export interface CommandRegistryOptions {
  readonly diagnostics?: DiagnosticsHub
  readonly notifyDenial?: CommandDenialNotifier
  /**
   * Where the page is, which decides whose shortcuts fire: an App's only while this pathname is
   * inside its boundary. Omitted, only the host page's shortcuts fire.
   */
  readonly readPathname?: () => string
}

const UNMATCHED: ShortcutDispatchResult = Object.freeze({ status: 'unmatched' })

/**
 * Commands are stored per scope, so a name may repeat across mounts but never inside one
 * and a mount's disposal cannot take the host page's with it.
 */
export class CommandRegistry {
  readonly #byScope = new Map<string, Map<string, RegisteredCommand>>()
  readonly #snapshot = new SnapshotSource<readonly CommandEntry[]>(Object.freeze([]))
  readonly #options: CommandRegistryOptions
  /** Read once: what `mod` means cannot change while the page is open. */
  readonly #apple = isApplePlatform()
  /** The chords of a sequence typed so far, dropped when the next one is too late. */
  #pressed: readonly PressedChord[] = []
  #pressedAt = 0

  constructor(options: CommandRegistryOptions = {}) {
    this.#options = options
  }

  /** Stable references for `useSyncExternalStore`. */
  readonly getSnapshot = (): readonly CommandEntry[] => this.#snapshot.getSnapshot()
  readonly subscribe = (listener: () => void): Unsubscribe => this.#snapshot.subscribe(listener)

  get size(): number {
    let total = 0
    for (const commands of this.#byScope.values()) total += commands.size
    return total
  }

  /**
   * Duplicate local names within a mount are rejected rather than overwritten; the same name in
   * another mount is fine because the runtime qualifies it.
   */
  register(owner: CommandOwner, registration: CommandRegistration): CommandRegistrationHandle {
    const { definitionId, mountToken } = owner
    if (definitionId === HOST_SCOPE || mountToken === HOST_SCOPE) {
      throw fail(definitionId, {
        operation: `register command '${registration.name}'`,
        expected: 'a definition id and the mount token the runtime issued for it',
        observed: `the reserved host scope ${HOST_SCOPE}`,
        repair:
          'Call registerHost instead. It is the one way into the host scope, so a host command and a mount command can never be confused for each other.',
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
   * from a real mount's, which would put the host's commands at the mercy of
   * `removeMount`.
   */
  registerHost(registration: CommandRegistration): CommandRegistrationHandle {
    return this.#add(
      { definitionId: HOST_SCOPE, scopeToken: HOST_SCOPE, shortcutScope: HOST_PAGE_SCOPE },
      registration,
    )
  }

  /** A mount's commands, and so its shortcuts, go with it. */
  removeMount(mountToken: string): void {
    if (!this.#byScope.delete(mountToken)) return
    // Handed the host scope's token, the host page's shortcuts went too, which frees any keys a
    // container was refused.
    if (mountToken === HOST_SCOPE) this.#refreshContainerShortcuts()
    this.#publish()
  }

  /**
   * The palette calls this when it opens; no other path evaluates all commands, because updating
   * one must not re-evaluate the rest.
   */
  evaluateAll(): void {
    let changed = false
    for (const command of this.#allCommands()) {
      if (this.#refreshEntry(command)) changed = true
    }
    if (changed) this.#publish()
  }

  /**
   * A denial does not run the command and does not fail silently: the reason reaches the
   * shell's notification surface and the entry's state updates.
   */
  async execute(qualifiedId: string): Promise<CommandExecutionResult> {
    const command = this.#find(qualifiedId)
    if (!command) {
      const error = fail(qualifiedId.split(':')[0] ?? qualifiedId, {
        operation: `execute command '${qualifiedId}'`,
        expected: 'a live registration, from a mount or from the host page',
        observed: 'no registration, so whoever registered it has gone away',
        repair:
          'Re-open the surface that registers this command. A mount command goes with its mount, and a host command with the chrome that registered it.',
      })
      this.#options.diagnostics?.report(error, { severity: 'warning' })
      return { status: 'unavailable', error }
    }

    return await this.#run(command)
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
          commandIds: match.targets.map(command => command.qualifiedId),
        }
      case 'complete':
        event.preventDefault()
        return {
          status: 'matched',
          commandId: match.target.qualifiedId,
          execution: this.#run(match.target),
        }
    }
  }

  async #run(command: RegisteredCommand): Promise<CommandExecutionResult> {
    const decision = this.#decide(command.definitionId, command.registration)
    if (!decision.allowed) {
      // Refresh this entry so the palette shows the current denial state.
      if (this.#refreshEntry(command)) this.#publish()
      this.#options.notifyDenial?.({
        commandId: command.qualifiedId,
        label: command.registration.label,
        reason: decision.reason,
      })
      return { status: 'denied', reason: decision.reason }
    }

    try {
      await command.registration.execute()
      return { status: 'executed' }
    } catch (error) {
      const structured = toMfeError(error, {
        code: 'mount/failure',
        id: command.definitionId,
        operation: `execute command '${command.registration.name}'`,
        repair:
          'Handle the failure inside the command, or surface it through the App’s own error UI.',
      })
      this.#options.diagnostics?.report(structured)
      return { status: 'failed', error: structured }
    }
  }

  dispose(): void {
    this.#byScope.clear()
    this.#pressed = []
    this.#snapshot.dispose()
  }

  #add(
    owner: Pick<RegisteredCommand, 'definitionId' | 'scopeToken' | 'shortcutScope'>,
    registration: CommandRegistration,
  ): CommandRegistrationHandle {
    const { definitionId, scopeToken } = owner
    const declared = this.#assertValid(definitionId, registration)

    const commands = this.#scopeCommands(scopeToken)
    if (commands.has(registration.name)) {
      throw this.#duplicateNameError(definitionId, registration.name)
    }

    const qualifiedId = `${definitionId}:${registration.name}`
    const usable = this.#usableShortcut(owner.shortcutScope, declared)
    const unpublished = { ...owner, qualifiedId, registration, declared, usable }
    const command: RegisteredCommand = { ...unpublished, entry: this.#buildEntry(unpublished) }

    commands.set(registration.name, command)
    if (declared) this.#afterShortcutChange(command)
    this.#publish()

    let active = true
    return {
      qualifiedId,
      update: next => {
        if (active) this.#update(command, next)
      },
      remove: () => {
        if (!active) return
        active = false
        const owned = this.#byScope.get(scopeToken)
        if (owned) {
          owned.delete(command.registration.name)
          if (owned.size === 0) this.#byScope.delete(scopeToken)
        }
        // A host shortcut going away frees the keys for a container that was refused them.
        if (command.shortcutScope.kind === 'reserved' && command.declared) {
          this.#refreshContainerShortcuts()
        }
        this.#publish()
      },
    }
  }

  #update(command: RegisteredCommand, next: CommandRegistration): void {
    const commands = this.#scopeCommands(command.scopeToken)
    const shortcutChanged = next.shortcut !== command.registration.shortcut

    // Changing `name` replaces the local registration, with the same validation as a fresh
    // register. Otherwise the shortcut is parsed only when it changed, because this runs after
    // every commit of the component that registered it.
    let { declared } = command
    if (next.name !== command.registration.name) {
      declared = this.#assertValid(command.definitionId, next)
      if (commands.has(next.name)) {
        throw this.#duplicateNameError(command.definitionId, next.name)
      }
      commands.delete(command.registration.name)
      commands.set(next.name, command)
      command.qualifiedId = `${command.definitionId}:${next.name}`
    } else if (shortcutChanged) {
      declared = this.#parseDeclared(command.definitionId, next)
    }
    command.registration = next
    command.declared = declared
    if (shortcutChanged) command.usable = this.#usableShortcut(command.shortcutScope, declared)

    let changed = this.#refreshEntry(command)
    if (shortcutChanged && this.#afterShortcutChange(command)) changed = true
    if (changed) this.#publish()
  }

  /**
   * Reported once, when a shortcut is declared or changes, rather than on every key press: a
   * Widget's is refused, a container's that the host page uses is refused, and one that another
   * live registration could be pressed for at the same time collides with it. A change to the
   * host page's shortcuts can claim or free a container's keys; returns whether that changed an
   * entry, so the caller publishes once.
   */
  #afterShortcutChange(command: RegisteredCommand): boolean {
    const { declared, shortcutScope } = command
    if (declared) {
      const refusal = this.#shortcutRefusal(shortcutScope, declared)
      if (refusal === undefined) this.#reportCollisions(command, declared)
      else this.#reportRefusal(command, declared, refusal)
    }
    return shortcutScope.kind === 'reserved' && this.#refreshContainerShortcuts()
  }

  /**
   * The host page's shortcuts changed, so a container's may have been claimed or freed. Returns
   * whether any entry changed; the caller publishes.
   */
  #refreshContainerShortcuts(): boolean {
    let changed = false
    for (const command of this.#allCommands()) {
      const { declared, shortcutScope } = command
      if (shortcutScope.kind === 'reserved' || !declared) continue
      const refusal = this.#shortcutRefusal(shortcutScope, declared)
      const had = command.usable
      command.usable = refusal === undefined ? declared : undefined
      if (!this.#refreshEntry(command)) continue
      changed = true
      if (had !== undefined && refusal !== undefined) {
        this.#reportRefusal(command, declared, refusal)
      }
    }
    return changed
  }

  /**
   * Why a declared shortcut may not fire. A Widget is an embedded fragment and does not own the
   * page's keys, as it does not own its URL; the host page's keys are the one set every page
   * has, so a container cannot take them, nor begin or extend one of them. The host scope's own
   * commands are the only ones read, so a check costs the host page's count, not everyone's.
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

  /** Commands whose shortcut can fire right now, from the host page and from every active App. */
  #liveShortcuts(inField: boolean): ShortcutCandidate<RegisteredCommand>[] {
    const pathname = readOnce(() => this.#options.readPathname?.())
    const live: ShortcutCandidate<RegisteredCommand>[] = []

    for (const command of this.#allCommands()) {
      const shortcut = command.usable
      // A chord typed into a field is text, unless every step of it holds a modifier.
      if (!shortcut || (inField && !firesInsideFields(shortcut))) continue
      if (isLive(command.shortcutScope, pathname)) live.push({ shortcut, target: command })
    }
    return live
  }

  #reportCollisions(command: RegisteredCommand, declared: ParsedShortcut): void {
    const rivals: RegisteredCommand[] = []
    for (const other of this.#allCommands()) {
      const theirs = other.usable
      if (other === command || !theirs) continue
      if (!canCoexist(command.shortcutScope, other.shortcutScope)) continue
      if (shortcutsOverlap(declared, theirs, this.#apple)) rivals.push(other)
    }
    if (rivals.length === 0) return

    this.#options.diagnostics?.report(
      fail(command.definitionId, {
        operation: `register the shortcut '${declared.source}' for command '${command.registration.name}'`,
        expected: 'keys no other live command can be pressed for at the same time',
        observed: `${rivals.map(rival => `'${rival.qualifiedId}' (${rival.registration.shortcut ?? ''})`).join(', ')} already claims them`,
        repair:
          'Give one of them different keys. Neither runs while both are registered, because letting whichever registered first win would depend on mount order.',
      }),
      { severity: 'warning' },
    )
  }

  #reportRefusal(
    command: RegisteredCommand,
    declared: ParsedShortcut,
    refusal: ShortcutRefusal,
  ): void {
    const operation = `register the shortcut '${declared.source}' for command '${command.registration.name}'`
    const error =
      refusal.reason === 'widget'
        ? fail(command.definitionId, {
            operation,
            expected: 'a shortcut from an App or the host page',
            observed: 'a shortcut from a Widget, which does not own the page’s keys',
            repair:
              'Drop the shortcut; the command stays in the palette without it. If the keys matter, emit an event and let the App that places the Widget register the shortcut.',
          })
        : fail(command.definitionId, {
            operation,
            expected: 'keys the host page does not use',
            observed: `the host page’s '${refusal.by.qualifiedId}' (${refusal.by.declared?.source ?? ''}) uses them`,
            repair:
              'Choose other keys. The command stays in the palette, but its shortcut is ignored while the host page reserves these.',
          })
    this.#options.diagnostics?.report(error, { severity: 'warning' })
  }

  #scopeCommands(scopeToken: string): Map<string, RegisteredCommand> {
    let commands = this.#byScope.get(scopeToken)
    if (!commands) {
      commands = new Map()
      this.#byScope.set(scopeToken, commands)
    }
    return commands
  }

  *#allCommands(): Generator<RegisteredCommand> {
    for (const commands of this.#byScope.values()) yield* commands.values()
  }

  #find(qualifiedId: string): RegisteredCommand | undefined {
    for (const command of this.#allCommands()) {
      if (command.qualifiedId === qualifiedId) return command
    }
    return undefined
  }

  #decide(definitionId: string, registration: CommandRegistration): Decision {
    const { canExecute } = registration
    if (!canExecute) return allow()

    try {
      return canExecute()
    } catch (error) {
      // Treating a throwing availability check as allowed would run a command whose
      // preconditions are unknown, so it denies and reports instead.
      this.#options.diagnostics?.report(
        toMfeError(error, {
          code: 'mount/failure',
          id: definitionId,
          operation: `evaluate canExecute for '${registration.name}'`,
          repair:
            'canExecute must be a pure synchronous read of reactive state. Move the failing work into execute.',
        }),
      )
      return {
        allowed: false,
        reason: 'This command is unavailable because its availability check failed.',
      }
    }
  }

  #buildEntry(command: CommandShape): CommandEntry {
    const { definitionId, registration, usable } = command
    return Object.freeze({
      id: command.qualifiedId,
      definitionId,
      name: registration.name,
      label: registration.label,
      placements: registration.placements ?? DEFAULT_PLACEMENTS,
      decision: this.#decide(definitionId, registration),
      ...(usable === undefined ? {} : { shortcut: usable.source }),
    })
  }

  /**
   * An identical visible result keeps the existing entry reference, so the palette's snapshot does
   * not change and no subscriber re-renders. Returns whether the entry changed.
   */
  #refreshEntry(command: RegisteredCommand): boolean {
    const next = this.#buildEntry(command)
    if (commandEntryEqual(command.entry, next)) return false
    command.entry = next
    return true
  }

  #publish(): void {
    this.#snapshot.set(Object.freeze([...this.#allCommands()].map(command => command.entry)))
  }

  #duplicateNameError(definitionId: string, name: string): MfeError {
    return fail(definitionId, {
      operation: `register command '${name}'`,
      expected: 'one registration per command name within a mount',
      observed: `a second registration of '${name}' in the same mount`,
      repair:
        'Rename one of the commands. Duplicate local names are rejected rather than overwritten, so neither registration silently wins.',
    })
  }

  /** Returns the parsed shortcut, so a valid registration is parsed exactly once. */
  #assertValid(
    definitionId: string,
    registration: CommandRegistration,
  ): ParsedShortcut | undefined {
    const { name, label } = registration
    if (!COMMAND_NAME_PATTERN.test(name)) {
      throw fail(definitionId, {
        operation: 'register command',
        expected:
          'a name of letters, digits and hyphens starting with a letter (for example "refresh")',
        observed: name === '' ? 'an empty string' : JSON.stringify(name),
        repair:
          'Rename the command. The runtime qualifies it internally as <definitionId>:<name>, which needs an unambiguous local name.',
      })
    }

    if (label === '') {
      throw fail(definitionId, {
        operation: `register command '${name}'`,
        expected: 'a non-empty label',
        observed: 'an empty string',
        repair: 'Add a human-readable label; the palette has nothing to render without one.',
      })
    }

    for (const placement of registration.placements ?? DEFAULT_PLACEMENTS) {
      if (VALID_PLACEMENTS.has(placement)) continue
      throw fail(definitionId, {
        operation: `register command '${name}'`,
        expected: `a standardized placement (${[...VALID_PLACEMENTS].join(', ')})`,
        observed: JSON.stringify(placement),
        repair:
          'Only command-palette is standardized. Future placements add placement records to this model.',
      })
    }

    return this.#parseDeclared(definitionId, registration)
  }

  #parseDeclared(
    definitionId: string,
    registration: CommandRegistration,
  ): ParsedShortcut | undefined {
    if (registration.shortcut === undefined) return undefined
    const parsed = parseShortcut(registration.shortcut)
    if (parsed.ok) return parsed.shortcut

    throw fail(definitionId, {
      operation: `register command '${registration.name}'`,
      expected:
        'a shortcut such as "mod+s" — modifiers (mod, ctrl, alt, shift, meta) and one key joined by + — or a sequence of them separated by spaces, such as "g r"',
      observed: `${JSON.stringify(registration.shortcut)}: ${parsed.problem}`,
      repair: 'Fix the shortcut, or remove it; the command works from the palette without one.',
    })
  }
}

type ShortcutRefusal =
  { readonly reason: 'widget' } | { readonly reason: 'reserved'; readonly by: RegisteredCommand }

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
