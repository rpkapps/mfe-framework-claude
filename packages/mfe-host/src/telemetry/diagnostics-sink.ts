/**
 * Framework diagnostics, reported as telemetry.
 *
 * A hub with no sink collects and drops, and a quarantined entry or an
 * unreadable record is the class of failure a deployed page most needs to
 * report. Every host wires the same translation, so it is written once and
 * vendor-neutrally: a provider decides what to do with a finished record, this
 * only decides what the record says.
 */

import type { Diagnostic, DiagnosticsSink, TelemetryProvider } from '@company/mfe-core'

/**
 * Every diagnostic reported to the hub, into `provider` as a `framework`
 * record. The provider's own level filter is honoured, so a shell that collects
 * only errors is not handed warnings it would drop.
 */
export function telemetryDiagnosticsSink(provider: TelemetryProvider): DiagnosticsSink {
  return ({ severity, error, context, timestamp }: Diagnostic): void => {
    const level = severity === 'error' ? 'error' : 'warn'
    if (provider.isLevelEnabled?.(level) === false) return

    const { definitionVersion } = error
    provider.record({
      kind: 'framework',
      level,
      operation: error.operation,
      message: error.message,
      error,
      attributes: {
        code: error.code,
        ...(definitionVersion === undefined ? {} : { definitionVersion }),
        ...context,
      },
      // A page-owned diagnostic is filed under 'app' because `definitionKind`
      // has no third value, and widening the contract for one sink would make
      // every consumer handle a kind that means "not a definition". Nothing
      // reads it to name the subject: `definitionId` is already `@host` there,
      // and that cannot be mistaken for a definition id.
      attribution: { definitionId: error.id, definitionKind: 'app' },
      timestamp,
    })
  }
}
