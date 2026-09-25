/** Structured framework errors: the code is the machine artifact, the message is for a reader. */

/** Closed union, so adding a code is a contract change and two conditions use a near one (§7). */
export type MfeErrorCode =
  | 'registry/invalid-entry'
  | 'registry/duplicate-id'
  | 'contract/unsupported-major'
  | 'contract/input-mismatch'
  | 'contract/output-mismatch'
  | 'config/missing'
  | 'config/unreachable'
  | 'config/invalid'
  | 'load/manifest-failure'
  | 'load/entry-failure'
  // Declared, never raised on the React path: the federation loader cannot see a duplicated
  // singleton, which reaches a developer as a framework hook rendered outside any mount.
  | 'load/share-conflict'
  | 'load/timeout'
  | 'mount/failure'
  | 'mount/timeout'
  | 'action/duplicate-name'
  | 'action/invalid-registration'
  | 'action/shortcut-refused'
  | 'action/unavailable'
  | 'app/invalid-base-path'
  | 'app/invalid-router'
  | 'storage/failure'
  | 'auth/undeclared-origin'
  | 'dispose/failure'
  | 'dispose/timeout'

export type MfeErrorDirection = 'input' | 'output'

export interface MfeError extends Error {
  readonly code: MfeErrorCode
  readonly id: string
  readonly definitionVersion?: string
  readonly operation: string
  readonly direction?: MfeErrorDirection
  readonly path?: readonly (string | number)[]
  readonly cause?: unknown
}

/** `expected`, `observed` and `repair` are omitted only when there is nothing to say. */
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
  /** One concrete next action. */
  readonly repair?: string
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

/** Objects report their shape, not their contents: logging whole payloads is forbidden. */
export function describeValue(value: unknown): string {
  if (value === null) return 'null'

  switch (typeof value) {
    case 'string':
      return value.length > 40 ? `a string of length ${value.length}` : JSON.stringify(value)
    case 'number':
    case 'boolean':
    case 'bigint':
      return String(value)
    case 'symbol':
      return value.toString()
    // A function's `String` form is its whole source, the dump this function exists to avoid.
    case 'function':
      return 'a function'
    case 'undefined':
      return 'undefined'
    default:
      break
  }

  if (Array.isArray(value)) return `an array of length ${value.length}`
  const name = value.constructor?.name
  return name !== undefined && name !== 'Object' ? `a ${name}` : 'an object'
}

function composeMessage(details: MfeErrorDetails): string {
  const { id, definitionVersion, operation, expected, observed, repair } = details
  const subject = definitionVersion ? `${id}@${definitionVersion}` : id
  const field = formatPath(details.path)
  let message = `${subject} failed to ${field ? `${operation} ${field}` : operation}`

  if (expected !== undefined) {
    message +=
      observed === undefined
        ? `: expected ${expected}.`
        : `: expected ${expected}, received ${observed}.`
  } else message += observed === undefined ? '.' : `: ${observed}.`

  return repair === undefined ? message : `${message} ${repair}`
}

/** Use everywhere instead of `new Error`, so every failure reads the same way. */
export function createMfeError(details: MfeErrorDetails): MfeError {
  return new FrameworkError(composeMessage(details), details)
}

/** Whatever `fixed` omits stays required at the call site, and a fixed field can be overridden. */
export function createMfeErrorFactory<Fixed extends Partial<MfeErrorDetails>>(
  fixed: Fixed,
): (details: Omit<MfeErrorDetails, keyof Fixed> & Partial<MfeErrorDetails>) => MfeError {
  return details => {
    // Together the parameter types cover every required field, unseen through the generic spread.
    const merged = { ...fixed, ...details }
    return createMfeError(merged as MfeErrorDetails)
  }
}

export function isMfeError(value: unknown): value is MfeError {
  return value instanceof FrameworkError
}

/** A boundary must report something structured even when remote code threw a string. */
export function toMfeError(
  value: unknown,
  fallback: Omit<MfeErrorDetails, 'cause' | 'observed'> & { readonly observed?: string },
): MfeError {
  if (isMfeError(value)) return value
  return createMfeError({
    ...fallback,
    observed: fallback.observed ?? describeThrown(value),
    cause: value,
  })
}

export function describeThrown(value: unknown): string {
  return value instanceof Error ? `${value.name}: ${value.message}` : describeValue(value)
}
