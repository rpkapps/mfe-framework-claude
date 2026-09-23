/**
 * Wired through a real `DiagnosticsHub` rather than called directly, because that is the path a
 * shell actually builds.
 */

import { describe, expect, it } from 'vitest'
import { createMfeError, DiagnosticsHub, HOST_SCOPE } from '@company/mfe-core'

import { createRecordingTelemetryProvider } from '../testing/recording-provider.ts'
import { telemetryDiagnosticsSink } from './diagnostics-sink.ts'

function wire(enabledLevels?: readonly ('debug' | 'info' | 'warn' | 'error')[]) {
  const provider = createRecordingTelemetryProvider(
    enabledLevels === undefined ? {} : { enabledLevels },
  )
  const hub = new DiagnosticsHub()
  hub.add(telemetryDiagnosticsSink(provider))
  return { hub, provider }
}

const unreadable = createMfeError({
  code: 'storage/failure',
  id: 'acme-orders',
  definitionVersion: '2.4.1',
  operation: "read 'filters'",
  expected: 'a stored value matching the declared schema',
  observed: 'a record written by an older build',
})

describe('telemetryDiagnosticsSink', () => {
  it('records a reported error as a framework record carrying the error itself', () => {
    const { hub, provider } = wire()

    hub.report(unreadable, { context: { entry: 'acme-orders' } })

    const [record] = provider.frameworkRecords()
    expect(record).toMatchObject({
      kind: 'framework',
      level: 'error',
      operation: "read 'filters'",
      message: unreadable.message,
      error: unreadable,
      attributes: {
        code: 'storage/failure',
        definitionVersion: '2.4.1',
        entry: 'acme-orders',
      },
      attribution: { definitionId: 'acme-orders', definitionKind: 'app' },
    })
    expect(record?.timestamp).toBeGreaterThan(0)
  })

  it('maps a warning to warn, and leaves out a version the error did not carry', () => {
    const { hub, provider } = wire()

    hub.report(
      createMfeError({ code: 'config/invalid', id: HOST_SCOPE, operation: 'read an override' }),
      { severity: 'warning' },
    )

    const [record] = provider.frameworkRecords()
    expect(record?.level).toBe('warn')
    expect(record?.attribution).toEqual({ definitionId: HOST_SCOPE, definitionKind: 'app' })
    expect(record?.attributes).toEqual({ code: 'config/invalid' })
  })

  it('honours the provider level filter, so a warning is never built for a shell that drops it', () => {
    const { hub, provider } = wire(['error'])

    hub.report(unreadable, { severity: 'warning' })
    expect(provider.records).toHaveLength(0)

    hub.report(unreadable)
    expect(provider.records).toHaveLength(1)
  })
})
