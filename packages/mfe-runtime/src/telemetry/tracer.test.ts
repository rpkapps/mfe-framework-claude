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

function setup(
  provider: TelemetryProvider = createRecordingTelemetryProvider(),
  options: { readonly enabled?: boolean; readonly now?: () => number } = {},
) {
  const diagnostics: Diagnostic[] = []
  const runtime = new MountTelemetryRuntime(provider, ATTRIBUTION, {
    dev: true,
    onDiagnostic: diagnostic => diagnostics.push(diagnostic),
    ...(options.now === undefined ? {} : { now: options.now }),
  })
  const tracer = new MountTracer(runtime, { enabled: options.enabled ?? true })
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
    const { provider, runtime, tracer } = recording()

    const span = started(tracer.startSpan('s'.repeat(400)))
    span.setAttributes({ 'mfe.span.id': 'forged', route: 'quote' })

    const record = at(provider.spans)
    expect(record.name).toHaveLength(256)
    expect(record.attributes['mfe.span.id']).toBe(span.spanId)
    expect(record.attributes['route']).toBe('quote')
    expect(runtime.counters.reservedOverrideAttempts).toBe(1)
  })
})

describe('ending a span', () => {
  it('treats repeated end() calls as harmless and releases the span once', () => {
    const { provider, tracer } = recording()
    const span = started(tracer.startSpan('checkout'))
    expect(tracer.openSpanCount).toBe(1)

    span.end()
    span.end()

    expect(tracer.openSpanCount).toBe(0)
    expect(provider.endedSpans()).toHaveLength(1)
  })

  it('labels an abandoned span without an error status', () => {
    const { provider, tracer } = recording()

    started(tracer.startSpan('checkout')).endAbandoned()

    const record = at(provider.spans)
    expect(record.endTime).toBeDefined()
    expect(record.attributes['mfe.span.end_reason']).toBe('abandoned')
    expect(record.attributes['mfe.span.cancelled']).toBeUndefined()
    expect(record.status.code).toBe(SpanStatusCode.UNSET)
    expect(tracer.openSpanCount).toBe(0)
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
  it('starts nothing past the per-mount budget, until a span ends', () => {
    const { provider, diagnostics, runtime, tracer } = recording()

    const spans: (MountSpan | undefined)[] = []
    for (let index = 0; index < TELEMETRY_LIMITS.maxOpenSpansPerMount; index += 1) {
      spans.push(tracer.startSpan(`span-${index}`))
    }

    expect(tracer.startSpan('one-too-many')).toBeUndefined()
    expect(provider.spansNamed('one-too-many')).toHaveLength(0)
    expect(runtime.counters.spansDroppedAtLimit).toBe(1)
    expect(diagnostics.some(d => d.error.message.includes('one-too-many'))).toBe(true)

    started(at(spans)).end()
    tracer.startSpan('room-again')
    expect(provider.spansNamed('room-again')).toHaveLength(1)
  })
})

describe('disposal finalizes outstanding spans', () => {
  it('closes open spans as cancelled without turning them into failures', () => {
    const provider = createRecordingTelemetryProvider()
    const { runtime, tracer } = setup(provider, { now: () => 4242 })
    tracer.startSpan('open')
    started(tracer.startSpan('succeeded-step')).setStatus(SpanStatusCode.OK)
    started(tracer.startSpan('done')).end()

    tracer.finalizeOpenSpans()

    const open = at(provider.spansNamed('open'))
    expect(open.endTime).toBe(4242)
    expect(open.attributes['mfe.span.cancelled']).toBe(true)
    expect(open.attributes['mfe.span.end_reason']).toBe('mount-disposed')
    expect(open.status.code).toBe(SpanStatusCode.UNSET)
    expect(at(provider.spansNamed('succeeded-step')).status.code).toBe(SpanStatusCode.OK)
    expect(at(provider.spansNamed('done')).attributes['mfe.span.cancelled']).toBeUndefined()
    expect(runtime.counters.spansFinalizedAtDisposal).toBe(2)
    expect(tracer.openSpanCount).toBe(0)
  })

  it('starts nothing once the mount is disposed', () => {
    const { provider, runtime, tracer } = recording()
    runtime.markDisposed()

    expect(tracer.startSpan('after-dispose')).toBeUndefined()
    expect(provider.spans).toHaveLength(0)
  })
})

describe('tracing switched off or broken', () => {
  it('never asks the provider for a tracer when tracing is disabled', () => {
    const provider = createRecordingTelemetryProvider()
    const { tracer } = setup(provider, { enabled: false })

    expect(tracer.startSpan('checkout')).toBeUndefined()
    expect(provider.tracerCount).toBe(0)
  })

  it('contains a provider whose createTracer throws', () => {
    const provider = createRecordingTelemetryProvider()
    provider.failTracerCreation(true)
    const { runtime, tracer } = setup(provider)

    expect(tracer.startSpan('checkout')).toBeUndefined()
    expect(runtime.counters.sinkFailures).toBe(1)
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
    const { runtime, tracer } = setup({
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

    expect(runtime.counters.sinkFailures).toBe(4)
    expect(tracer.openSpanCount).toBe(0)
  })

  it('starts nothing when the provider tracer throws on startSpan', () => {
    const { runtime, tracer } = setup({
      record: () => {},
      createTracer: () => ({
        startSpan: () => {
          throw new Error('cannot start')
        },
      }),
    })

    expect(tracer.startSpan('checkout')).toBeUndefined()
    expect(runtime.counters.sinkFailures).toBe(1)
    expect(runtime.counters.spansStarted).toBe(0)
  })
})
