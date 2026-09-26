/**
 * Every validation and lifecycle failure reaches a sink the shell wires to monitoring.
 * `DiagnosticsHub`, which fans a failure out to every registered sink, lives in
 * `@company/mfe-runtime`; the sink and event shapes stay here so a neutral package can describe
 * them without holding the fan-out itself.
 */

import type { MfeError } from './errors.ts'

export type DiagnosticSeverity = 'warning' | 'error'

export interface Diagnostic {
  readonly severity: DiagnosticSeverity
  readonly error: MfeError
  /** Extra non-sensitive context, e.g. the consumer that dropped an output. */
  readonly context?: Readonly<Record<string, string | number | boolean>>
  readonly timestamp: number
}

export type DiagnosticsSink = (diagnostic: Diagnostic) => void
