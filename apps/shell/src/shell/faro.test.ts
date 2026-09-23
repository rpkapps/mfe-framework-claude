/** Asserts the translation against a fake Faro api: no network, no SDK initialization. */

import { createNonRecordingTracer } from '@company/mfe-react/host'
import type { SpanRecord, TelemetryAttribution } from '@company/mfe-react/host'
import type { Faro } from '@grafana/faro-web-sdk'
import { describe, expect, it, vi } from 'vitest'

import { createFaroTelemetryProvider } from './faro.ts'

const ATTRIBUTION: TelemetryAttribution = {
  definitionId: 'acme-orders',
  definitionKind: 'app',
  definitionVersion: '2.1.0',
  mountToken: 'mount-7',
}

const ATTRIBUTED = {
  definitionId: 'acme-orders',
  definitionKind: 'app',
  definitionVersion: '2.1.0',
  mountToken: 'mount-7',
}

const BASE = { attributes: {}, attribution: ATTRIBUTION, timestamp: 0 } as const

function harness() {
  const api = {
    pushEvent: vi.fn(),
    pushLog: vi.fn(),
    pushError: vi.fn(),
    pushMeasurement: vi.fn(),
  }
  // Only the four push methods the adapter may reach for.
  const faro = { api } as unknown as Faro

  let sink: ((span: SpanRecord) => void) | undefined
  const provider = createFaroTelemetryProvider({
    faro,
    createTracer: (_attribution, onSpanEnd) => {
      sink = onSpanEnd
      return createNonRecordingTracer()
    },
  })

  return {
    api,
    provider,
    endSpan: (span: SpanRecord): void => {
      provider.createTracer(ATTRIBUTION)
      sink?.(span)
    },
  }
}

describe('the Faro adapter', () => {
  it('sends an author event with its attribution attached', () => {
    const { provider, api } = harness()

    provider.record({ kind: 'event', name: 'report.exported', ...BASE, attributes: { rows: 42 } })

    expect(api.pushEvent).toHaveBeenCalledWith('report.exported', { ...ATTRIBUTED, rows: '42' })
  })

  it('refuses to let an author attribute overwrite attribution', () => {
    const { provider, api } = harness()

    provider.record({
      kind: 'event',
      name: 'spoof',
      ...BASE,
      attributes: { definitionId: 'someone-else' },
    })

    expect(api.pushEvent).toHaveBeenCalledWith('spoof', ATTRIBUTED)
  })

  it('sends a measurement with its unit as the value key', () => {
    const { provider, api } = harness()

    provider.record({
      kind: 'measurement',
      name: 'report.export.duration',
      value: 1234,
      unit: 'ms',
      ...BASE,
    })

    expect(api.pushMeasurement).toHaveBeenCalledWith(
      { type: 'report.export.duration', values: { ms: 1234 } },
      { context: ATTRIBUTED },
    )
  })

  it('routes a log by level, and an error to pushError rather than pushLog', () => {
    const { provider, api } = harness()

    provider.record({ kind: 'log', level: 'warn', message: 'slow', ...BASE })
    provider.record({
      kind: 'log',
      level: 'error',
      message: 'failed',
      error: new Error('boom'),
      ...BASE,
    })

    expect(api.pushLog).toHaveBeenCalledTimes(1)
    expect(api.pushLog).toHaveBeenCalledWith(['slow'], {
      level: 'warn',
      context: { ...ATTRIBUTED, recordKind: 'log' },
    })
    expect(api.pushError).toHaveBeenCalledTimes(1)
  })

  it('keeps a framework diagnostic distinguishable from author telemetry', () => {
    const { provider, api } = harness()

    provider.record({
      kind: 'framework',
      level: 'error',
      operation: 'mount App',
      message: 'mount failed',
      ...BASE,
    })

    expect(api.pushLog).toHaveBeenCalledWith(['mount failed'], {
      level: 'error',
      context: { ...ATTRIBUTED, recordKind: 'framework', operation: 'mount App' },
    })
  })

  it('reports a completed span, including the exceptions it recorded', () => {
    const { api, endSpan } = harness()

    endSpan({
      name: 'load.reports',
      kind: 0,
      attributes: {},
      attribution: ATTRIBUTION,
      startTime: 100,
      endTime: 350,
      status: { code: 2, message: 'upstream 500' },
      events: [],
      exceptions: [new Error('upstream 500')],
    })

    expect(api.pushEvent).toHaveBeenCalledWith('span.load.reports', {
      ...ATTRIBUTED,
      durationMs: '250',
      status: '2',
      statusMessage: 'upstream 500',
    })
    expect(api.pushError).toHaveBeenCalledTimes(1)
  })
})
