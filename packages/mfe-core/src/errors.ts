/**
 * Structured framework errors (§7.3) and the diagnostic message rules in §17.4.
 *
 * Every developer-facing failure names the definition, the operation, the
 * relevant field or resource, what was expected, what was observed, and which
 * side declared the expectation — then gives a concrete repair step. The code is
 * the machine artifact; the message is what a developer actually reads at 2am.
 */

/**
 * Closed union so hosts can handle each case exhaustively. Adding a code is a
 * deliberate contract change (§7.3).
 */
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
 * The parts of a diagnostic message that §17.4 requires. `expected`,
 * `observed`, `declaredBy` and `repair` are optional only because a few
 * failures (a bare transport error, for example) genuinely have nothing to say
 * for them; omitting one to save effort is a review defect, not a shortcut.
 */
export interface MfeErrorDetails {
  readonly code: MfeErrorCode
  readonly id: string
  readonly operation: string
  readonly definitionVersion?: string
  readonly direction?: MfeErrorDirection
  readonly path?: readonly (string | number)[]
  readonly cause?: unknown
  /** What the framework required, in the developer's vocabulary. */
  readonly expected?: string
  /** What actually arrived or happened. */
  readonly observed?: string
  /** Which side declared the expectation, e.g. "The Widget provider". */
  readonly declaredBy?: string
  /** One concrete next action. */
  readonly repair?: string
  /** Extra context appended verbatim, e.g. "The previous valid inputs remain displayed." */
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
 * Describes a runtime value for a diagnostic without dumping it. Strings are
 * quoted and truncated; objects report their shape rather than their contents,
 * because §5.16.4 and §17.4 both forbid logging whole payloads.
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
  const constructorName = (value as object).constructor?.name
  if (constructorName && constructorName !== 'Object') return `a ${constructorName} instance`
  return 'an object'
}

function composeMessage(details: MfeErrorDetails): string {
  const subject = details.definitionVersion
    ? `${details.id}@${details.definitionVersion}`
    : details.id
  const field = formatPath(details.path)

  const sentences: string[] = []

  const target = field ? `${details.operation} ${field}` : details.operation
  if (details.expected !== undefined && details.observed !== undefined) {
    sentences.push(`${subject} failed to ${target}: expected ${details.expected}, received ${details.observed}.`)
  } else if (details.expected !== undefined) {
    sentences.push(`${subject} failed to ${target}: expected ${details.expected}.`)
  } else if (details.observed !== undefined) {
    sentences.push(`${subject} failed to ${target}: ${details.observed}.`)
  } else {
    sentences.push(`${subject} failed to ${target}.`)
  }

  if (details.declaredBy !== undefined) sentences.push(`${details.declaredBy} declares this expectation.`)
  if (details.repair !== undefined) sentences.push(details.repair)
  if (details.note !== undefined) sentences.push(details.note)

  return sentences.join(' ')
}

/**
 * Builds a structured error with a message that satisfies §17.4. Use this
 * everywhere rather than `new Error`, so every failure carries the same fields
 * and reads the same way.
 */
export function createMfeError(details: MfeErrorDetails): MfeError {
  return new FrameworkError(composeMessage(details), details)
}

export function isMfeError(value: unknown): value is MfeError {
  return value instanceof FrameworkError
}

/**
 * Normalizes an unknown thrown value into a structured error without losing the
 * original cause. Used at boundaries that must report something structured even
 * when remote code threw a string.
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
