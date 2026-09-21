/** The one `Diagnostic`-to-`TelemetryRecord` translation, so no host repeats it (§25). */

import type { Diagnostic, DiagnosticsSink, TelemetryProvider } from '@company/mfe-core'

/** Reports every diagnostic into `provider` as a `framework` record, honouring its level filter. */
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
      // A page-owned diagnostic is filed under 'app' because `definitionKind` has no third
      // value; `definitionId` is already `@host`, which no definition id can be.
      attribution: { definitionId: error.id, definitionKind: 'app' },
      timestamp,
    })
  }
}
