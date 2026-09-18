/**
 * Structured framework errors. The code is the machine artifact; the message is
 * what a developer reads at 2am, so every failure names the definition, the
 * operation, the field, the expectation, what was observed, who declared it,
 * and one repair step.
 */

/** Closed union: hosts handle it exhaustively, so adding a code is a contract change. */
export type MfeErrorCode =
  | 'registry/invalid-descriptor'
  | 'registry/duplicate-id'
  | 'contract/unsupported-major'
  | 'contract/input-mismatch'
  | 'contract/event-mismatch'
  | 'config/missing'
  | 'config/unreachable'
  | 'config/invalid'
  | 'load/manifest-failure'
  | 'load/entry-failure'
  | 'load/share-conflict'
  | 'load/timeout'
  | 'mount/failure'
  | 'mount/timeout'
  | 'command/duplicate-name'
  | 'app/invalid-base-path'
  | 'app/invalid-router'
  | 'storage/failure'
  | 'auth/undeclared-origin'
  | 'dispose/failure'
  | 'dispose/timeout'

/** Direction of a contract violation relative to the Widget boundary. */
export type MfeErrorDirection = 'input' | 'event'

export interface MfeError extends Error {
  readonly code: MfeErrorCode
  readonly id: string
  readonly definitionVersion?: string
  readonly operation: string
  readonly direction?: MfeErrorDirection
  readonly path?: readonly (string | number)[]
  readonly cause?: unknown
}

/**
 * `expected`, `observed`, `declaredBy` and `repair` are optional only because a
 * few failures (a bare transport error) genuinely have nothing to say for them;
 * omitting one to save effort is a review defect.
 */
export interface MfeErrorDetails {
  readonly code: MfeErrorCode
  readonly id: string
  readonly operation: string
  readonly definitionVersion?: string
  readonly direction?: MfeErrorDirection
  readonly path?: readonly (string | number)[]
  readonly cause?: unknown
  readonly expected?: string
  readonly observed?: string
  /** Which side declared the expectation, e.g. "The Widget provider". */
  readonly declaredBy?: string
  /** One concrete next action. */
  readonly repair?: string
  /** Appended verbatim, e.g. "The previous valid inputs remain displayed." */
  readonly note?: string
}

class FrameworkError extends Error implements MfeError {
  readonly code: MfeErrorCode
  readonly id: string
  readonly operation: string
  readonly definitionVersion?: string
  readonly direction?: MfeErrorDirection
  readonly path?: readonly (string | number)[]

  constructor(message: string, details: MfeErrorDetails) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause })
    this.name = 'MfeError'
    this.code = details.code
    this.id = details.id
    this.operation = details.operation
    if (details.definitionVersion !== undefined) this.definitionVersion = details.definitionVersion
    if (details.direction !== undefined) this.direction = details.direction
    if (details.path !== undefined) this.path = details.path
  }
}

/** Renders a field path as the dotted/bracketed form a developer would write. */
export function formatPath(path: readonly (string | number)[] | undefined): string {
  if (!path || path.length === 0) return ''
  let rendered = ''
  for (const segment of path) {
    if (typeof segment === 'number') rendered += `[${segment}]`
    else if (rendered === '') rendered = segment
    else rendered += `.${segment}`
  }
  return rendered
}

/**
 * Describes a runtime value without dumping it: objects report their shape
 * rather than their contents, because logging whole payloads is forbidden.
 */
export function describeValue(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  switch (typeof value) {
    case 'string':
      return value.length > 40 ? `a string of length ${value.length}` : JSON.stringify(value)
    case 'number':
    case 'boolean':
    case 'bigint':
      return String(value)
    case 'function':
      return 'a function'
    case 'symbol':
      return 'a symbol'
    default:
      break
  }
  if (Array.isArray(value)) return `an array of length ${value.length}`
  if (value instanceof Date) return 'a Date'
  if (value instanceof Map) return 'a Map'
  if (value instanceof Set) return 'a Set'
  const constructorName = value.constructor?.name
  if (constructorName && constructorName !== 'Object') return `a ${constructorName} instance`
  return 'an object'
}

function composeMessage(details: MfeErrorDetails): string {
  const subject = details.definitionVersion
    ? `${details.id}@${details.definitionVersion}`
    : details.id
  const field = formatPath(details.path)
  const target = field ? `${details.operation} ${field}` : details.operation

  const sentences: string[] = []
  if (details.expected !== undefined && details.observed !== undefined) {
    sentences.push(
      `${subject} failed to ${target}: expected ${details.expected}, received ${details.observed}.`,
    )
  } else if (details.expected !== undefined) {
    sentences.push(`${subject} failed to ${target}: expected ${details.expected}.`)
  } else if (details.observed !== undefined) {
    sentences.push(`${subject} failed to ${target}: ${details.observed}.`)
  } else {
    sentences.push(`${subject} failed to ${target}.`)
  }

  if (details.declaredBy !== undefined)
    sentences.push(`${details.declaredBy} declares this expectation.`)
  if (details.repair !== undefined) sentences.push(details.repair)
  if (details.note !== undefined) sentences.push(details.note)

  return sentences.join(' ')
}

/** Use everywhere instead of `new Error`, so every failure reads the same way. */
export function createMfeError(details: MfeErrorDetails): MfeError {
  return new FrameworkError(composeMessage(details), details)
}

/**
 * Fixes the fields a module repeats — typically `code`, `id` and `declaredBy` —
 * so a throw site carries only what differs. Whatever `fixed` omits stays
 * required at the call site, and any fixed field can be overridden there.
 */
export function createMfeErrorFactory<Fixed extends Partial<MfeErrorDetails>>(
  fixed: Fixed,
): (details: Omit<MfeErrorDetails, keyof Fixed> & Partial<MfeErrorDetails>) => MfeError {
  return details => {
    // The two parameter types together cover every required field, which the
    // compiler cannot see through the generic spread.
    const merged = { ...fixed, ...details }
    return createMfeError(merged as MfeErrorDetails)
  }
}

export function isMfeError(value: unknown): value is MfeError {
  return value instanceof FrameworkError
}

/**
 * Normalizes an unknown thrown value without losing the original cause. Used at
 * boundaries that must report something structured even when remote code threw
 * a string.
 */
export function toMfeError(
  value: unknown,
  fallback: Omit<MfeErrorDetails, 'cause' | 'observed'> & { readonly observed?: string },
): MfeError {
  if (isMfeError(value)) return value
  const observed =
    fallback.observed ??
    (value instanceof Error ? `${value.name}: ${value.message}` : describeValue(value))
  return createMfeError({ ...fallback, observed, cause: value })
}
