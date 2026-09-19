/**
 * Mount-scoped command registration: hold the current set, publish a palette
 * snapshot. The performance contract is the interesting part — replacing
 * `execute`/`canExecute` closure identity must not change the public snapshot,
 * and updating one command must not re-evaluate any other.
 */

import {
  allow,
  commandEntryEqual,
  createMfeError,
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
  readonly mountToken: string
  registration: CommandRegistration
  /** The last published entry; reused when nothing visible changed. */
  entry: CommandEntry
}

export interface CommandRegistryOptions {
  readonly diagnostics?: DiagnosticsHub
  readonly notifyDenial?: CommandDenialNotifier
}

/**
 * Commands are stored per mount so duplicate-name validation is scoped the way
 * the contract describes: a name may repeat across mounts, never inside one.
 */
export class CommandRegistry {
  readonly #byMount = new Map<string, Map<string, RegisteredCommand>>()
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
    for (const commands of this.#byMount.values()) total += commands.size
    return total
  }

  /**
   * Registers one command for one mount. Duplicate local names within a mount
   * are rejected rather than overwritten; the same local name in a different
   * mount is fine because the runtime qualifies it.
   */
  register(
    definitionId: string,
    mountToken: string,
    registration: CommandRegistration,
  ): CommandRegistrationHandle {
    this.#assertValid(definitionId, registration)

    const commands = this.#mountCommands(mountToken)
    if (commands.has(registration.name)) {
      throw this.#duplicateNameError(definitionId, registration.name)
    }

    const qualifiedId = `${definitionId}:${registration.name}`
    const command: RegisteredCommand = {
      qualifiedId,
      definitionId,
      mountToken,
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
        const owned = this.#byMount.get(mountToken)
        if (owned) {
          owned.delete(command.registration.name)
          if (owned.size === 0) this.#byMount.delete(mountToken)
        }
        this.#publish()
      },
    }
  }

  /** Removes every command owned by a mount. Used by disposal. */
  removeMount(mountToken: string): void {
    if (!this.#byMount.delete(mountToken)) return
    this.#publish()
  }

  /**
   * Re-evaluates every registration. The palette calls this when it opens; no
   * other path evaluates all commands, because updating one command must not
   * re-evaluate the rest.
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
   * Executes a command after re-checking the latest committed `canExecute`.
   * A denial does not run the command and does not fail silently: the reason
   * reaches the shell's notification surface and the entry's state updates.
   */
  async execute(qualifiedId: string): Promise<CommandExecutionResult> {
    const command = this.#find(qualifiedId)
    if (!command) {
      const error = fail(qualifiedId.split(':')[0] ?? qualifiedId, {
        operation: `execute command '${qualifiedId}'`,
        expected: 'a command registered by a live mount',
        observed: 'no registration, so its definition is unloaded or disposed',
        repair:
          'Re-open the surface that registers this command. Commands from a disposed mount are unavailable.',
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
    this.#byMount.clear()
    this.#snapshot.dispose()
  }

  #update(command: RegisteredCommand, next: CommandRegistration): void {
    const commands = this.#mountCommands(command.mountToken)

    // Changing `name` replaces the local registration, with the same duplicate
    // validation as a fresh register.
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

    // Evaluate only this registration. An identical visible result keeps the
    // existing entry reference, so the palette's snapshot does not change and
    // no subscriber re-renders.
    const candidate = this.#buildEntry(command.qualifiedId, command.definitionId, next)
    if (commandEntryEqual(command.entry, candidate)) return

    command.entry = candidate
    this.#publish()
  }

  #mountCommands(mountToken: string): Map<string, RegisteredCommand> {
    let commands = this.#byMount.get(mountToken)
    if (!commands) {
      commands = new Map()
      this.#byMount.set(mountToken, commands)
    }
    return commands
  }

  *#allCommands(): Generator<RegisteredCommand> {
    for (const commands of this.#byMount.values()) yield* commands.values()
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
      // A throwing availability check is a defect in the registering component.
      // Treating it as allowed would run a command whose preconditions are
      // unknown, so it denies and reports instead.
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
          'Only command-palette is standardized. Future placements add placement descriptors to this model.',
      })
    }
  }
}
