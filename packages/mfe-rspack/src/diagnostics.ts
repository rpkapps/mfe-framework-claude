/**
 * Build-time diagnostics. Same rule as `createMfeError` in the neutral core —
 * subject, operation, expectation, observation, one concrete repair — plus the
 * file and line, because opening it is the developer's next action.
 */

import type { MfeErrorCode } from '@company/mfe-core'

export interface BuildDiagnosticDetails {
  /** Reporting code, when one of the runtime codes applies to this failure. */
  readonly code?: MfeErrorCode
  /** Absolute path of the file the developer should open. */
  readonly file: string
  /** One-based line, when the position is known. */
  readonly line?: number
  /** One-based column, when the position is known. */
  readonly column?: number
  /** Definition id, once the build has read one. */
  readonly id?: string
  /** What the build was doing, for example "read the Widget contract". */
  readonly operation: string
  /** What the build required, in the developer's vocabulary. */
  readonly expected: string
  /** What the source actually contains. */
  readonly observed: string
  /** Which side declared the expectation, for example "Static discovery". */
  readonly declaredBy?: string
  /** One concrete next action. */
  readonly repair: string
  /** Extra context appended verbatim. */
  readonly note?: string
  readonly cause?: unknown
}

/**
 * A build failure. Rspack accepts `Error` instances in `compilation.errors`, so
 * this is both what the plugin throws and what it reports.
 */
class MfeBuildError extends Error {
  readonly code: MfeErrorCode | undefined
  readonly file: string
  readonly line: number | undefined
  readonly column: number | undefined
  readonly id: string | undefined
  readonly operation: string

  constructor(message: string, details: BuildDiagnosticDetails) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause })
    this.name = 'MfeBuildError'
    this.code = details.code
    this.file = details.file
    this.line = details.line
    this.column = details.column
    this.id = details.id
    this.operation = details.operation
  }
}

function composeBuildMessage(details: BuildDiagnosticDetails): string {
  const { file, line, column } = details
  const location =
    line === undefined
      ? file
      : column === undefined
        ? `${file}:${line}`
        : `${file}:${line}:${column}`
  const subject = details.id === undefined ? 'the build' : `'${details.id}'`

  const sentences = [
    `${location}: ${subject} failed to ${details.operation}: expected ${details.expected}, found ${details.observed}.`,
  ]
  if (details.declaredBy !== undefined)
    sentences.push(`${details.declaredBy} declares this expectation.`)
  sentences.push(details.repair)
  if (details.note !== undefined) sentences.push(details.note)

  return sentences.join(' ')
}

/**
 * Builds a build-time failure whose message satisfies the same rules the
 * runtime errors follow. Use this rather than `new Error` everywhere.
 */
export function createBuildError(details: BuildDiagnosticDetails): MfeBuildError {
  return new MfeBuildError(composeBuildMessage(details), details)
}

export function isMfeBuildError(value: unknown): value is MfeBuildError {
  return value instanceof MfeBuildError
}

/** Renders a list of names the way a diagnostic should read them out. */
export function listNames(names: readonly string[]): string {
  if (names.length === 0) return 'nothing'
  if (names.length === 1) return `'${names[0] ?? ''}'`
  const quoted = names.map(name => `'${name}'`)
  const last = quoted[quoted.length - 1] ?? ''
  return `${quoted.slice(0, -1).join(', ')} and ${last}`
}
