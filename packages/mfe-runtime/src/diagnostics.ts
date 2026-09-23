/** Fans out to several sinks, none of which can stop the others from being called. */

import type { Diagnostic, DiagnosticSeverity, DiagnosticsSink, MfeError } from '@company/mfe-core'

export class DiagnosticsHub {
  readonly #sinks = new Set<DiagnosticsSink>()

  constructor(sinks: readonly DiagnosticsSink[] = []) {
    for (const sink of sinks) this.#sinks.add(sink)
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
        // Re-reporting a failing sink would recurse straight back into the sink that threw.
      }
    }
  }

  clear(): void {
    this.#sinks.clear()
  }
}
