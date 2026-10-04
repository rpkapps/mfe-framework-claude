/** The span machinery behind workflows: ids and parentage, containment, bounds and disposal. */

import { describe, expect, it } from 'vitest'

import {
  SpanKind,
  SpanStatusCode,
  TELEMETRY_LIMITS,
  type Diagnostic,
  type Span,
  type TelemetryProvider,
} from '@company/mfe-core'

import { createRecordingTelemetryProvider } from '../testing/recording-provider.ts'
import { MountTelemetryRuntime } from './runtime.ts'
import { MountTracer, type MountSpan } from './tracer.ts'
import { at, ATTRIBUTION } from './__tests__/harness.ts'

function setup(provider: TelemetryProvider = createRecordingTelemetryProvider()) {
  const diagnostics: Diagnostic[] = []
  const runtime = new MountTelemetryRuntime(provider, ATTRIBUTION, {
    dev: true,
    onDiagnostic: diagnostic => diagnostics.push(diagnostic),
  })
  const tracer = new MountTracer(runtime)
  return { diagnostics, runtime, tracer }
}

function recording() {
  const provider = createRecordingTelemetryProvider()
  return { provider, ...setup(provider) }
}

function started(span: MountSpan | undefined): MountSpan {
  if (span === undefined) throw new Error('expected a recording span')
  return span
}

describe('starting a span', () => {
  it('asks the provider for one tracer and records a span with host attribution', () => {
    const { provider, tracer } = recording()

    tracer.startSpan('checkout', { attributes: { items: 3 } })

    expect(provider.tracerCount).toBe(1)
    const record = at(provider.spans)
    expect(record.name).toBe('checkout')
    expect(record.kind).toBe(SpanKind.INTERNAL)
    expect(record.attribution).toEqual(ATTRIBUTION)
    expect(record.attributes['items']).toBe(3)
    expect(record.attributes['mfe.definition.id']).toBe('operations-console')
    expect(record.attributes['mfe.span.parent_id']).toBeUndefined()
  })

  it('starts a fresh trace without a parent and joins the parent trace with one', () => {
    const { provider, tracer } = recording()

    const root = started(tracer.startSpan('checkout'))
    const child = started(tracer.startSpan('place order', { parent: root }))
    tracer.startSpan('another workflow')

    expect(child.traceId).toBe(root.traceId)
    expect(child.spanId).not.toBe(root.spanId)
    expect(at(provider.spans, 1).parent).toBe(at(provider.spans, 0))
    expect(at(provider.spans, 1).attributes['mfe.span.parent_id']).toBe(root.spanId)
    expect(at(provider.spans, 2).attributes['mfe.trace.id']).not.toBe(root.traceId)
  })

  it('uses W3C id shapes', () => {
    const { tracer } = recording()

    const span = started(tracer.startSpan('checkout'))

    expect(span.traceId).toMatch(/^[0-9a-f]{32}$/)
    expect(span.spanId).toMatch(/^[0-9a-f]{16}$/)
  })

  it('bounds the name and refuses reserved attribute keys', () => {
    const { provider, diagnostics, tracer } = recording()

    const span = started(tracer.startSpan('s'.repeat(400)))
    span.setAttributes({ 'mfe.span.id': 'forged', route: 'quote' })

    const record = at(provider.spans)
    expect(record.name).toHaveLength(256)
    expect(record.attributes['mfe.span.id']).toBe(span.spanId)
    expect(record.attributes['route']).toBe('quote')
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics).error.message).toContain('mfe.span.id')
  })
})

describe('ending a span', () => {
  it('treats repeated end() calls as harmless', () => {
    const { provider, tracer } = recording()
    const span = started(tracer.startSpan('checkout'))

    span.end()
    span.end()
    span.endAbandoned()

    expect(provider.endedSpans()).toHaveLength(1)
    expect(at(provider.spans).attributes['mfe.span.end_reason']).toBeUndefined()
  })

  it('labels an abandoned span without an error status', () => {
    const { provider, tracer } = recording()

    started(tracer.startSpan('checkout')).endAbandoned()

    const record = at(provider.spans)
    expect(record.endTime).toBeDefined()
    expect(record.attributes['mfe.span.end_reason']).toBe('abandoned')
    expect(record.status.code).toBe(SpanStatusCode.UNSET)
  })

  it('ignores every change after end', () => {
    const { provider, tracer } = recording()
    const span = started(tracer.startSpan('checkout'))
    span.setStatus(SpanStatusCode.OK)
    span.end()

    span.setAttributes({ late: true })
    span.setStatus(SpanStatusCode.ERROR)
    span.recordException(new Error('too late'))

    const record = at(provider.spans)
    expect(record.attributes['late']).toBeUndefined()
    expect(record.events).toHaveLength(0)
    expect(record.status).toEqual({ code: SpanStatusCode.OK })
  })
})

describe('bounded open-span tracking', () => {
  it('starts nothing past the per-mount budget, until a span ends or is abandoned', () => {
    const { provider, diagnostics, tracer } = recording()

    const spans: (MountSpan | undefined)[] = []
    for (let index = 0; index < TELEMETRY_LIMITS.maxOpenSpansPerMount; index += 1) {
      spans.push(tracer.startSpan(`span-${index}`))
    }

    expect(tracer.startSpan('one-too-many')).toBeUndefined()
    expect(provider.spansNamed('one-too-many')).toHaveLength(0)
    expect(diagnostics.some(d => d.error.message.includes('one-too-many'))).toBe(true)

    started(at(spans)).end()
    expect(tracer.startSpan('room-again')).toBeDefined()
    expect(tracer.startSpan('full-again')).toBeUndefined()

    started(at(spans, 1)).endAbandoned()
    expect(tracer.startSpan('room-after-abandoning')).toBeDefined()
  })
})

describe('disposal', () => {
  it('starts nothing once the mount is disposed', () => {
    const { provider, runtime, tracer } = recording()
    runtime.markDisposed()

    expect(tracer.startSpan('after-dispose')).toBeUndefined()
    expect(provider.spans).toHaveLength(0)
  })
})

describe('a broken provider', () => {
  it('contains a provider whose createTracer throws', () => {
    const provider = createRecordingTelemetryProvider()
    provider.failTracerCreation(true)
    const { diagnostics, tracer } = setup(provider)

    expect(tracer.startSpan('checkout')).toBeUndefined()
    expect(diagnostics.map(diagnostic => diagnostic.error.operation)).toEqual(['create a tracer'])
  })

  it('contains a span implementation that throws on every member', () => {
    const explode = (): never => {
      throw new Error('vendor span exploded')
    }
    const hostileSpan: Span = {
      setAttributes: explode,
      setStatus: explode,
      recordException: explode,
      end: explode,
    }
    const { diagnostics, tracer } = setup({
      record: () => {},
      createTracer: () => ({ startSpan: () => hostileSpan }),
    })

    expect(() => {
      const span = started(tracer.startSpan('checkout'))
      span.setAttributes({ b: 2 })
      span.setStatus(SpanStatusCode.OK)
      span.recordException(new Error('x'))
      span.end()
    }).not.toThrow()

    expect(diagnostics.map(diagnostic => diagnostic.error.operation)).toEqual([
      'set span attributes',
      'set a span status',
      'record a span exception',
      'end a span',
    ])
  })

  it('starts nothing when the provider tracer throws on startSpan', () => {
    const { diagnostics, tracer } = setup({
      record: () => {},
      createTracer: () => ({
        startSpan: () => {
          throw new Error('cannot start')
        },
      }),
    })

    expect(tracer.startSpan('checkout')).toBeUndefined()
    expect(diagnostics.map(diagnostic => diagnostic.error.operation)).toEqual(['start a span'])
  })
})
