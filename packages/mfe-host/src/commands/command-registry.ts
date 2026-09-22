/**
 * Scoped command registration, where the host page is one more scope so a palette renders
 * one list instead of merging a snapshot with a hard-coded one (§26). The performance
 * contract is the interesting part: replacing `execute`/`canExecute` closure identity must
 * not change the public snapshot, and updating one command must not re-evaluate any other.
 */

import {
  allow,
  commandEntryEqual,
  createMfeError,
  HOST_SCOPE,
  SnapshotSource,
  toMfeError,
  type CommandEntry,
  type CommandPlacement,
  type CommandRegistration,
  type Decision,
  type DiagnosticsHub,
  type MfeError,
  type MfeErrorDetails,
  type Unsubscribe,
} from '@company/mfe-core'

const DEFAULT_PLACEMENTS: readonly CommandPlacement[] = Object.freeze(['command-palette'])
const VALID_PLACEMENTS = new Set<string>(DEFAULT_PLACEMENTS)

/** Restricted so `<definitionId>:<name>` stays unambiguous. */
const COMMAND_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9-]*$/

/** Every registration failure this module raises carries the same code. */
function fail(id: string, details: Omit<MfeErrorDetails, 'code' | 'id' | 'declaredBy'>): MfeError {
  return createMfeError({
    code: 'command/duplicate-name',
    id,
    ...details,
  })
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
  registration: CommandRegistration
  /** The last published entry; reused when nothing visible changed. */
  entry: CommandEntry
}

export interface CommandRegistryOptions {
  readonly diagnostics?: DiagnosticsHub
  readonly notifyDenial?: CommandDenialNotifier
}

/**
 * Commands are stored per scope, so a name may repeat across mounts but never inside one
 * and a mount's disposal cannot take the host page's with it (§26).
 */
export class CommandRegistry {
  readonly #byScope = new Map<string, Map<string, RegisteredCommand>>()
  readonly #snapshot = new SnapshotSource<readonly CommandEntry[]>(Object.freeze([]))
  readonly #options: CommandRegistryOptions

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
  register(
    definitionId: string,
    mountToken: string,
    registration: CommandRegistration,
  ): CommandRegistrationHandle {
    if (definitionId === HOST_SCOPE || mountToken === HOST_SCOPE) {
      throw fail(definitionId, {
        operation: `register command '${registration.name}'`,
        expected: 'a definition id and the mount token the runtime issued for it',
        observed: `the reserved host scope ${HOST_SCOPE}`,
        repair:
          'Call registerHost instead. It is the one way into the host scope, so a host command and a mount command can never be confused for each other.',
      })
    }

    return this.#add(definitionId, mountToken, registration)
  }

  /**
   * A host has no definition id and no mount token, and a made-up token cannot be told
   * from a real mount's, which would put the host's commands at the mercy of
   * `removeMount` (§26).
   */
  registerHost(registration: CommandRegistration): CommandRegistrationHandle {
    return this.#add(HOST_SCOPE, HOST_SCOPE, registration)
  }

  removeMount(mountToken: string): void {
    if (!this.#byScope.delete(mountToken)) return
    this.#publish()
  }

  /**
   * The palette calls this when it opens; no other path evaluates all commands, because updating
   * one must not re-evaluate the rest.
   */
  evaluateAll(): void {
    let changed = false
    for (const command of this.#allCommands()) {
      const next = this.#buildEntry(command.qualifiedId, command.definitionId, command.registration)
      if (commandEntryEqual(command.entry, next)) continue
      command.entry = next
      changed = true
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

    const decision = this.#decide(command.definitionId, command.registration)
    if (!decision.allowed) {
      // Refresh this entry so the palette shows the current denial state.
      const next = this.#buildEntry(command.qualifiedId, command.definitionId, command.registration)
      if (!commandEntryEqual(command.entry, next)) {
        command.entry = next
        this.#publish()
      }
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
    this.#snapshot.dispose()
  }

  #add(
    definitionId: string,
    scopeToken: string,
    registration: CommandRegistration,
  ): CommandRegistrationHandle {
    this.#assertValid(definitionId, registration)

    const commands = this.#scopeCommands(scopeToken)
    if (commands.has(registration.name)) {
      throw this.#duplicateNameError(definitionId, registration.name)
    }

    const qualifiedId = `${definitionId}:${registration.name}`
    const command: RegisteredCommand = {
      qualifiedId,
      definitionId,
      scopeToken,
      registration,
      entry: this.#buildEntry(qualifiedId, definitionId, registration),
    }

    commands.set(registration.name, command)
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
        this.#publish()
      },
    }
  }

  #update(command: RegisteredCommand, next: CommandRegistration): void {
    const commands = this.#scopeCommands(command.scopeToken)

    // Changing `name` replaces the local registration, with the same duplicate validation
    // as a fresh register.
    if (next.name !== command.registration.name) {
      this.#assertValid(command.definitionId, next)
      if (commands.has(next.name)) {
        throw this.#duplicateNameError(command.definitionId, next.name)
      }
      commands.delete(command.registration.name)
      command.registration = next
      command.qualifiedId = `${command.definitionId}:${next.name}`
      command.entry = this.#buildEntry(command.qualifiedId, command.definitionId, next)
      commands.set(next.name, command)
      this.#publish()
      return
    }

    command.registration = next

    // An identical visible result keeps the existing entry reference, so the palette's
    // snapshot does not change and no subscriber re-renders.
    const candidate = this.#buildEntry(command.qualifiedId, command.definitionId, next)
    if (commandEntryEqual(command.entry, candidate)) return

    command.entry = candidate
    this.#publish()
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

  #buildEntry(
    qualifiedId: string,
    definitionId: string,
    registration: CommandRegistration,
  ): CommandEntry {
    return Object.freeze({
      id: qualifiedId,
      definitionId,
      name: registration.name,
      label: registration.label,
      placements: registration.placements ?? DEFAULT_PLACEMENTS,
      decision: this.#decide(definitionId, registration),
    })
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

  #assertValid(definitionId: string, registration: CommandRegistration): void {
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
  }
}
