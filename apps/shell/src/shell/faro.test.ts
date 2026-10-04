/** Asserts the translation against a fake Faro api: no network, no SDK initialization. */

import {
  createContainerTransport,
  createSpanEmitter,
  installShellAuth,
  type SpanRecord,
  type TelemetryAttribution,
} from '@company/mfe-react/host'
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
    pushTraces: vi.fn(),
  }
  const metas = {
    value: {
      app: { name: 'shell', version: '4.2.0' },
      session: { id: 'session-1' },
      user: { id: 'u-7' },
    },
  }
  // Only the push methods the adapter may reach for, and the metas a span is stamped with.
  const faro = { api, metas } as unknown as Faro

  let sink: ((span: SpanRecord) => void) | undefined
  const provider = createFaroTelemetryProvider({
    faro,
    createTracer: (_attribution, onSpanEnd) => {
      sink = onSpanEnd
      // The adapter only forwards the tracer; these tests drive the span sink directly.
      return { startSpan: vi.fn() }
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

    expect(api.pushEvent).toHaveBeenCalledWith(
      'report.exported',
      { ...ATTRIBUTED, rows: '42' },
      undefined,
      {},
    )
  })

  it('links a record to the span it belongs to', () => {
    const { provider, api } = harness()
    const spanContext = { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) }

    provider.record({ kind: 'event', name: 'quote.requested', ...BASE, spanContext })
    provider.record({ kind: 'log', level: 'info', message: 'quoted', ...BASE, spanContext })
    provider.record({
      kind: 'log',
      level: 'error',
      message: 'failed',
      error: new Error('boom'),
      ...BASE,
      spanContext,
    })
    provider.record({
      kind: 'measurement',
      name: 'quote',
      value: 3,
      unit: 'ms',
      ...BASE,
      spanContext,
    })

    expect(api.pushEvent.mock.calls[0]?.[3]).toEqual({ spanContext })
    expect(api.pushLog.mock.calls[0]?.[1]).toMatchObject({ spanContext })
    expect(api.pushError.mock.calls[0]?.[1]).toMatchObject({ spanContext })
    expect(api.pushMeasurement.mock.calls[0]?.[1]).toMatchObject({ spanContext })
  })

  it('refuses to let an author attribute overwrite attribution', () => {
    const { provider, api } = harness()

    provider.record({
      kind: 'event',
      name: 'spoof',
      ...BASE,
      attributes: { definitionId: 'someone-else' },
    })

    expect(api.pushEvent).toHaveBeenCalledWith('spoof', ATTRIBUTED, undefined, {})
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

  it('sends a completed span as an OTLP trace with its own ids, and not its exceptions as errors', () => {
    const { api, endSpan } = harness()
    const spanContext = { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) }

    endSpan({
      name: 'POST',
      kind: 2,
      attributes: { 'http.response.status_code': 503, retried: false, ratio: 0.5 },
      attribution: ATTRIBUTION,
      startTime: 1_700_000_000_100,
      endTime: 1_700_000_000_350,
      status: { code: 2, message: '503' },
      events: [{ name: 'exception', attributes: {}, timestamp: 1_700_000_000_300 }],
      exceptions: [new Error('upstream 503')],
      spanContext,
      parentSpanId: 'c'.repeat(16),
    })

    expect(api.pushEvent).not.toHaveBeenCalled()
    expect(api.pushTraces).toHaveBeenCalledWith({
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: 'shell' } },
              { key: 'service.version', value: { stringValue: '4.2.0' } },
            ],
            droppedAttributesCount: 0,
          },
          scopeSpans: [
            {
              scope: { name: '@company/mfe-runtime' },
              spans: [
                {
                  traceId: spanContext.traceId,
                  spanId: spanContext.spanId,
                  parentSpanId: 'c'.repeat(16),
                  name: 'POST',
                  // CLIENT: OTLP numbers kinds from 1.
                  kind: 3,
                  startTimeUnixNano: '1700000000100000000',
                  endTimeUnixNano: '1700000000350000000',
                  attributes: [
                    { key: 'http.response.status_code', value: { intValue: 503 } },
                    { key: 'retried', value: { boolValue: false } },
                    { key: 'ratio', value: { doubleValue: 0.5 } },
                    { key: 'session.id', value: { stringValue: 'session-1' } },
                    { key: 'user.id', value: { stringValue: 'u-7' } },
                  ],
                  droppedAttributesCount: 0,
                  events: [
                    {
                      timeUnixNano: '1700000000300000000',
                      name: 'exception',
                      attributes: [],
                      droppedAttributesCount: 0,
                    },
                  ],
                  droppedEventsCount: 0,
                  links: [],
                  droppedLinksCount: 0,
                  status: { code: 2, message: '503' },
                },
              ],
            },
          ],
        },
      ],
    })
    // The failed workflow's own error record is what reaches pushError.
    expect(api.pushError).not.toHaveBeenCalled()
  })

  it("sends a request's client span with the id its traceparent names, and no path", async () => {
    const { api } = harness()
    const provider = createFaroTelemetryProvider({
      faro: { api, metas: { value: {} } } as unknown as Faro,
      createTracer: (attribution, onSpanEnd) => createSpanEmitter(attribution, { onSpanEnd }),
    })
    const sent: Headers[] = []
    const uninstall = installShellAuth({
      tokens: { getAccessToken: () => Promise.resolve('token-1') },
      fetch: (_input, init) => {
        sent.push(new Headers(init?.headers))
        return Promise.resolve(new Response('', { status: 503 }))
      },
      telemetry: provider,
    })

    try {
      await createContainerTransport({
        id: 'acme-orders',
        kind: 'app',
        apiOrigins: ['https://api.example.test'],
      }).fetch('https://api.example.test/orders/o-42?view=full', { method: 'POST' })
    } finally {
      uninstall()
    }

    const traces = api.pushTraces.mock.calls as [
      { resourceSpans: { scopeSpans: { spans: Record<string, unknown>[] }[] }[] },
    ][]
    const span = traces[0]?.[0].resourceSpans[0]?.scopeSpans[0]?.spans[0]
    expect(sent[0]?.get('traceparent')).toBe(
      `00-${String(span?.['traceId'])}-${String(span?.['spanId'])}-01`,
    )
    expect(span).toMatchObject({ name: 'POST', kind: 3, status: { code: 2 } })
    expect(span).not.toHaveProperty('parentSpanId')
    expect(span?.['attributes']).toEqual(
      expect.arrayContaining([
        { key: 'mfe.definition.id', value: { stringValue: 'acme-orders' } },
        { key: 'server.address', value: { stringValue: 'api.example.test' } },
        { key: 'http.response.status_code', value: { intValue: 503 } },
      ]),
    )
    expect(JSON.stringify(span)).not.toContain('o-42')
  })

  it('sends no trace for a span that has no ids', () => {
    const { api, endSpan } = harness()

    endSpan({
      name: 'detached',
      kind: 0,
      attributes: {},
      attribution: ATTRIBUTION,
      startTime: 0,
      endTime: 1,
      status: { code: 0 },
      events: [],
      exceptions: [],
    })

    expect(api.pushTraces).not.toHaveBeenCalled()
  })
})
