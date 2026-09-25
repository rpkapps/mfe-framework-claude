/**
 * What the agent knows of the page with each turn, in the layers the agentic plan (B) names:
 *
 * - the URL: the page's path and search params, and each mounted App's path inside its own
 *   boundary, read when a turn is sent rather than published, since the framework already knows
 *   every boundary;
 * - selections: a small, typed snapshot each mount publishes of what is selected or focused,
 *   through `useAgentContext` or `injectAgentContext`;
 * - prompt handoff: a click that becomes a chat turn, forwarded to whichever chat set a handler;
 * - suggestions: prompts a mount offers as ways to start or carry on, which the chat shows.
 *
 * A selection belongs to its mount, like an action, and goes with it (`removeMount`), so the
 * agent never acts on the selection of a mount that is gone; so do a mount's suggestions.
 */

import {
  createMfeError,
  findNonSerializableValue,
  HOST_SCOPE,
  isWithinBoundary,
  type AgentContextEntry,
  type AgentContextRegistration,
  type AgentPrompt,
  type AgentSuggestion,
  type AgentSuggestionEntry,
  type BoundaryLocation,
  type JsonSchemaValue,
  type MfeError,
  type Unsubscribe,
} from '@company/mfe-core'
import { z } from 'zod'

import type { DiagnosticsHub } from '../diagnostics.ts'
import { SnapshotSource } from '../observable.ts'

/**
 * The most a value may take as JSON. A selection is ids and a label; anything larger is a record,
 * which the agent should read through an action instead, fresh.
 */
export const MAX_AGENT_CONTEXT_LENGTH = 4096

/** Who published a selection; a mount's context already carries both fields. */
export interface AgentContextOwner {
  readonly definitionId: string
  readonly mountToken: string
}

/** The most suggestions one mount offers at once; the rest are left out. */
export const MAX_AGENT_SUGGESTIONS = 3

export interface AgentSuggestionsHandle {
  /** Replaces the mount's suggestions; an equal list publishes nothing. */
  update(suggestions: readonly AgentSuggestion[]): void
  remove(): void
}

export interface AgentContextHandle {
  /** Applies the latest value; an equal one publishes nothing. */
  update(registration: AgentContextRegistration): void
  remove(): void
}

/** A mounted App, and where the page is inside its boundary. */
export interface AgentAppLocation {
  readonly definitionId: string
  readonly basePath: string
  /** The page's path below `basePath`, starting with `/`. */
  readonly path: string
}

/** Everything sent with one turn. */
export interface AgentTurnContext {
  readonly url: {
    readonly pathname: string
    /** A key that repeats has every value, in order. */
    readonly search: Readonly<Record<string, string | readonly string[]>>
  }
  /** The Apps whose boundary holds the page, outermost first. */
  readonly apps: readonly AgentAppLocation[]
  readonly selections: readonly AgentContextEntry[]
}

/** A prompt as the chat receives it: `submit` settled, and who asked. */
export interface AgentPromptRequest extends AgentPrompt {
  readonly submit: boolean
  /** The definition whose code asked, or the reserved host scope. */
  readonly definitionId: string
}

export type AgentPromptHandler = (request: AgentPromptRequest) => void

export interface AgentContextStoreOptions {
  readonly diagnostics?: DiagnosticsHub | undefined
  /** Where the page is; omitted, the URL layer is empty. */
  readonly readLocation?: (() => BoundaryLocation) | undefined
  /** When a value changed; injectable so a test can fix it. */
  readonly now?: (() => Date) | undefined
}

interface Selection {
  readonly definitionId: string
  readonly scopeToken: string
  /** The JSON of the published value, to tell an equal value from a changed one cheaply. */
  json: string | undefined
  /** Absent while the latest value was refused; the previous one is not kept either. */
  entry: AgentContextEntry | undefined
  /** The last problem reported, so a value that stays invalid is reported once. */
  reported: string | undefined
}

interface Boundary {
  readonly definitionId: string
  readonly basePath: string
}

interface Suggestions {
  readonly definitionId: string
  readonly scopeToken: string
  json: string
  entries: readonly AgentSuggestionEntry[]
  /** The last problem reported, so a suggestion that stays invalid is reported once. */
  reported: string | undefined
}

const EMPTY: readonly AgentContextEntry[] = Object.freeze([])
const NO_SUGGESTIONS: readonly AgentSuggestionEntry[] = Object.freeze([])

export class AgentContextStore {
  /** In registration order, which is the order the agent reads them in. */
  readonly #selections = new Set<Selection>()
  readonly #boundaries = new Map<string, Boundary>()
  readonly #snapshot = new SnapshotSource<readonly AgentContextEntry[]>(EMPTY)
  readonly #suggestions = new Set<Suggestions>()
  readonly #suggestionSnapshot = new SnapshotSource<readonly AgentSuggestionEntry[]>(NO_SUGGESTIONS)
  readonly #options: AgentContextStoreOptions
  #promptHandler: AgentPromptHandler | undefined

  constructor(options: AgentContextStoreOptions = {}) {
    this.#options = options
  }

  /** The selections, as stable references for `useSyncExternalStore`. */
  readonly getSnapshot = (): readonly AgentContextEntry[] => this.#snapshot.getSnapshot()
  readonly subscribe = (listener: () => void): Unsubscribe => this.#snapshot.subscribe(listener)

  /** Every mount's suggestions, in registration order, as stable references. */
  readonly getSuggestions = (): readonly AgentSuggestionEntry[] =>
    this.#suggestionSnapshot.getSnapshot()
  readonly subscribeSuggestions = (listener: () => void): Unsubscribe =>
    this.#suggestionSnapshot.subscribe(listener)

  /** A mount's prompts for the chat to offer, while the mount lives. */
  suggest(
    owner: AgentContextOwner,
    suggestions: readonly AgentSuggestion[],
  ): AgentSuggestionsHandle {
    return this.#addSuggestions(owner.definitionId, owner.mountToken, suggestions)
  }

  /** The host page's own suggestions. */
  suggestHost(suggestions: readonly AgentSuggestion[]): AgentSuggestionsHandle {
    return this.#addSuggestions(HOST_SCOPE, HOST_SCOPE, suggestions)
  }

  register(owner: AgentContextOwner, registration: AgentContextRegistration): AgentContextHandle {
    return this.#add(owner.definitionId, owner.mountToken, registration)
  }

  /** The host page's own selection, which no mount's disposal can take. */
  registerHost(registration: AgentContextRegistration): AgentContextHandle {
    return this.#add(HOST_SCOPE, HOST_SCOPE, registration)
  }

  /**
   * Records an App's URL boundary for the URL layer; the mount context calls it for every App it
   * creates, so no author has to.
   */
  trackBoundary(owner: AgentContextOwner & { readonly basePath: string }): void {
    this.#boundaries.set(owner.mountToken, {
      definitionId: owner.definitionId,
      basePath: owner.basePath,
    })
  }

  /** A mount's selections and its boundary go with it. */
  removeMount(mountToken: string): void {
    this.#boundaries.delete(mountToken)
    let removed = false
    for (const selection of this.#selections) {
      if (selection.scopeToken !== mountToken) continue
      this.#selections.delete(selection)
      removed = true
    }
    if (removed) this.#publish()

    let offered = false
    for (const suggestions of this.#suggestions) {
      if (suggestions.scopeToken !== mountToken) continue
      this.#suggestions.delete(suggestions)
      offered = true
    }
    if (offered) this.#publishSuggestions()
  }

  /** Read when a turn is sent, so the URL is the page's at that moment. */
  read(): AgentTurnContext {
    const location = this.#options.readLocation?.()
    const pathname = location?.pathname ?? ''
    const apps: AgentAppLocation[] = []
    for (const { definitionId, basePath } of this.#boundaries.values()) {
      if (location === undefined || !isWithinBoundary(basePath, pathname)) continue
      apps.push({ definitionId, basePath, path: pathBelow(basePath, pathname) })
    }
    apps.sort((a, b) => a.basePath.length - b.basePath.length)

    return {
      url: { pathname, search: searchRecord(location?.search ?? '') },
      apps,
      selections: this.getSnapshot(),
    }
  }

  /**
   * The chat that turns a prompt into a turn. One at a time; the returned function removes it
   * only while it is still the one set.
   */
  setPromptHandler(handler: AgentPromptHandler): Unsubscribe {
    this.#promptHandler = handler
    return () => {
      if (this.#promptHandler === handler) this.#promptHandler = undefined
    }
  }

  /**
   * Hands a click to the chat. Returns whether a chat took it: without one, or with a prompt it
   * refuses, nothing happens and the caller can say so.
   */
  prompt(prompt: AgentPrompt, definitionId: string = HOST_SCOPE): boolean {
    const handler = this.#promptHandler
    if (!handler) return false

    const problem =
      prompt.message.trim() === ''
        ? 'an empty message'
        : prompt.context === undefined
          ? undefined
          : describeProblem(prompt.context)
    if (problem !== undefined) {
      this.#options.diagnostics?.report(
        createMfeError({
          code: 'contract/input-mismatch',
          id: definitionId,
          operation: 'hand a prompt to the agent',
          direction: 'input',
          expected: `a message, and context of JSON data no longer than ${String(MAX_AGENT_CONTEXT_LENGTH)} characters`,
          observed: problem,
          repair:
            'Send ids and a short label as context; the agent reads the records themselves through your actions.',
        }),
        { severity: 'warning' },
      )
      return false
    }

    handler({ ...prompt, submit: prompt.submit ?? true, definitionId })
    return true
  }

  dispose(): void {
    this.#selections.clear()
    this.#suggestions.clear()
    this.#suggestionSnapshot.dispose()
    this.#boundaries.clear()
    this.#promptHandler = undefined
    this.#snapshot.dispose()
  }

  #addSuggestions(
    definitionId: string,
    scopeToken: string,
    suggestions: readonly AgentSuggestion[],
  ): AgentSuggestionsHandle {
    const record: Suggestions = {
      definitionId,
      scopeToken,
      json: '[]',
      entries: NO_SUGGESTIONS,
      reported: undefined,
    }
    this.#suggestions.add(record)
    this.#applySuggestions(record, suggestions)
    this.#publishSuggestions()

    const live = (): boolean => this.#suggestions.has(record)
    return {
      update: next => {
        if (live() && this.#applySuggestions(record, next)) this.#publishSuggestions()
      },
      remove: () => {
        if (live() && this.#suggestions.delete(record)) this.#publishSuggestions()
      },
    }
  }

  /** Keeps the valid ones, up to the limit; returns whether what is offered changed. */
  #applySuggestions(record: Suggestions, suggestions: readonly AgentSuggestion[]): boolean {
    const kept: AgentSuggestionEntry[] = []
    const problems: string[] = []
    for (const suggestion of suggestions) {
      const problem =
        suggestion.message.trim() === ''
          ? 'an empty message'
          : suggestion.context === undefined
            ? undefined
            : describeProblem(suggestion.context)
      if (problem !== undefined) {
        problems.push(problem)
        continue
      }
      if (kept.length === MAX_AGENT_SUGGESTIONS) {
        problems.push(`more than ${String(MAX_AGENT_SUGGESTIONS)} suggestions`)
        break
      }
      kept.push(
        Object.freeze({
          ...suggestion,
          submit: suggestion.submit ?? true,
          definitionId: record.definitionId,
        }),
      )
    }

    const problem = problems.length === 0 ? undefined : problems.join('; ')
    if (problem !== undefined && problem !== record.reported) {
      this.#options.diagnostics?.report(
        createMfeError({
          code: 'contract/input-mismatch',
          id: record.definitionId,
          operation: 'offer agent suggestions',
          direction: 'input',
          expected: `up to ${String(MAX_AGENT_SUGGESTIONS)} suggestions, each a message with context of JSON data no longer than ${String(MAX_AGENT_CONTEXT_LENGTH)} characters`,
          observed: problem,
          repair: 'Offer the few prompts that matter most here; the rest are left out.',
        }),
        { severity: 'warning' },
      )
    }
    record.reported = problem

    const json = JSON.stringify(kept)
    if (json === record.json) return false
    record.json = json
    record.entries = kept
    return true
  }

  #publishSuggestions(): void {
    const entries: AgentSuggestionEntry[] = []
    for (const record of this.#suggestions) entries.push(...record.entries)
    const current = this.#suggestionSnapshot.getSnapshot()
    const unchanged =
      entries.length === current.length && entries.every((entry, index) => entry === current[index])
    if (!unchanged) {
      this.#suggestionSnapshot.set(entries.length === 0 ? NO_SUGGESTIONS : Object.freeze(entries))
    }
  }

  #add(
    definitionId: string,
    scopeToken: string,
    registration: AgentContextRegistration,
  ): AgentContextHandle {
    if (registration.description.trim() === '') {
      throw createMfeError({
        code: 'contract/input-mismatch',
        id: definitionId,
        operation: 'publish agent context',
        direction: 'input',
        expected: 'a description of what the value is',
        observed: 'an empty string',
        repair:
          'Say what the value is, such as "The wells the user has selected"; the model reads it to know what the value means.',
      })
    }

    const selection: Selection = {
      definitionId,
      scopeToken,
      json: undefined,
      entry: undefined,
      reported: undefined,
    }
    this.#selections.add(selection)
    this.#apply(selection, registration)
    this.#publish()

    const live = (): boolean => this.#selections.has(selection)
    return {
      update: next => {
        if (live() && this.#apply(selection, next)) this.#publish()
      },
      remove: () => {
        if (live() && this.#selections.delete(selection)) this.#publish()
      },
    }
  }

  /** Returns whether the published entry changed. */
  #apply(selection: Selection, registration: AgentContextRegistration): boolean {
    const described = this.#describe(selection, registration)
    if (described.problem !== undefined) {
      if (selection.reported !== described.problem) {
        selection.reported = described.problem
        this.#options.diagnostics?.report(described.error, { severity: 'warning' })
      }
      const had = selection.entry !== undefined
      selection.entry = undefined
      selection.json = undefined
      return had
    }

    selection.reported = undefined
    const { json } = described
    const previous = selection.entry
    if (previous && selection.json === json && previous.description === registration.description) {
      return false
    }

    const now = this.#options.now?.() ?? new Date()
    selection.entry = Object.freeze({
      definitionId: selection.definitionId,
      description: registration.description,
      value: parseJson(json),
      // A new description of the same value was captured when the value was.
      capturedAt: previous && selection.json === json ? previous.capturedAt : now.toISOString(),
    })
    selection.json = json
    return true
  }

  #describe(
    selection: Selection,
    registration: AgentContextRegistration,
  ):
    | { readonly problem: undefined; readonly json: string }
    | { readonly problem: string; readonly error: MfeError } {
    const parsed = registration.schema.safeParse(registration.value)
    const refuse = (problem: string, expected: string, cause?: unknown) => ({
      problem,
      error: createMfeError({
        code: 'contract/input-mismatch',
        id: selection.definitionId,
        operation: `publish agent context '${registration.description}'`,
        direction: 'input',
        expected,
        observed: problem,
        repair:
          'Publish ids and a short label that match the schema; the agent reads the records themselves through your actions. The context is left out until it is valid.',
        ...(cause === undefined ? {} : { cause }),
      }),
    })
    if (!parsed.success) {
      return refuse(z.prettifyError(parsed.error), 'a value its schema accepts', parsed.error)
    }

    const problem = describeProblem(parsed.data)
    if (problem !== undefined) {
      return refuse(
        problem,
        `JSON data no longer than ${String(MAX_AGENT_CONTEXT_LENGTH)} characters`,
      )
    }
    return { problem: undefined, json: JSON.stringify(parsed.data) }
  }

  #publish(): void {
    const entries: AgentContextEntry[] = []
    for (const { entry } of this.#selections) if (entry) entries.push(entry)
    const current = this.#snapshot.getSnapshot()
    const unchanged =
      entries.length === current.length && entries.every((entry, index) => entry === current[index])
    if (!unchanged) this.#snapshot.set(entries.length === 0 ? EMPTY : Object.freeze(entries))
  }
}

/** Why a value cannot go to the agent: not JSON, or too large. */
function describeProblem(value: unknown): string | undefined {
  const offender = findNonSerializableValue(value)
  if (offender) {
    const at = offender.path.length > 0 ? ` at ${offender.path.join('.')}` : ''
    return `${offender.description}${at}`
  }
  const length = JSON.stringify(value).length
  return length > MAX_AGENT_CONTEXT_LENGTH
    ? `${String(length)} characters of JSON, over the ${String(MAX_AGENT_CONTEXT_LENGTH)} a selection may take`
    : undefined
}

/** A copy the author cannot mutate afterwards, which is also plain JSON. */
function parseJson(json: string): JsonSchemaValue {
  return JSON.parse(json) as JsonSchemaValue
}

function pathBelow(basePath: string, pathname: string): string {
  const boundary = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath
  const rest = pathname.slice(boundary.length)
  return rest === '' ? '/' : rest
}

function searchRecord(search: string): Readonly<Record<string, string | readonly string[]>> {
  const record: Record<string, string | readonly string[]> = {}
  for (const [key, value] of new URLSearchParams(search)) {
    const existing = record[key]
    record[key] =
      existing === undefined
        ? value
        : typeof existing === 'string'
          ? [existing, value]
          : [...existing, value]
  }
  return record
}
