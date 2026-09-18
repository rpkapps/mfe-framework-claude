/**
 * The diagnostics sink.
 *
 * Logging alone is insufficient: a dropped event is silent by design, and
 * nobody reads logs until they already suspect a problem. Every validation and
 * lifecycle failure therefore reaches a sink the shell wires to production
 * monitoring.
 */

import type { MfeError } from './errors.ts'

export type DiagnosticSeverity = 'warning' | 'error'

export interface Diagnostic {
  readonly severity: DiagnosticSeverity
  readonly error: MfeError
  /** Extra non-sensitive context, e.g. the consumer that dropped an event. */
  readonly context?: Readonly<Record<string, string | number | boolean>>
  readonly timestamp: number
}

export type DiagnosticsSink = (diagnostic: Diagnostic) => void

/**
 * Fans out to several sinks. A sink that throws must not prevent the others
 * from receiving the diagnostic, and must not recursively report itself
 *, so its failure is counted rather than re-reported.
 */
export class DiagnosticsHub {
  readonly #sinks = new Set<DiagnosticsSink>()
  #sinkFailures = 0

  /** Bounded local counter for sink failures; never re-reported through itself. */
  get sinkFailureCount(): number {
    return this.#sinkFailures
  }

  add(sink: DiagnosticsSink): () => void {
    this.#sinks.add(sink)
    return () => {
      this.#sinks.delete(sink)
    }
  }

  report(
    error: MfeError,
    options: {
      readonly severity?: DiagnosticSeverity
      readonly context?: Readonly<Record<string, string | number | boolean>>
    } = {},
  ): void {
    if (this.#sinks.size === 0) return

    const diagnostic: Diagnostic = {
      severity: options.severity ?? 'error',
      error,
      ...(options.context === undefined ? {} : { context: options.context }),
      timestamp: Date.now(),
    }

    for (const sink of [...this.#sinks]) {
      try {
        sink(diagnostic)
      } catch {
        this.#sinkFailures += 1
      }
    }
  }

  clear(): void {
    this.#sinks.clear()
  }
}
