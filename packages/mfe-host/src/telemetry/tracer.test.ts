import { describe, expect, it, vi } from 'vitest'

import {
  SpanKind,
  SpanStatusCode,
  TELEMETRY_LIMITS,
  type Span,
  type TelemetryProvider,
  type Tracer,
} from '@company/mfe-core'

import { createRecordingTelemetryProvider } from './recording-provider.ts'
import { createMountTelemetry } from './service.ts'
import { nonRecordingSpan } from './span-emitter.ts'
import { at, ATTRIBUTION, setup, spanNamed } from './__tests__/harness.ts'

describe('span creation', () => {
  it('asks the provider for one tracer and records a span with host attribution', () => {
    const { provider, tracer } = setup()

    const span = tracer.startSpan('load-quotes', { attributes: { route: 'quote' } })

    expect(provider.tracerCount).toBe(1)
    const record = at(provider.spans)
    expect(record.name).toBe('load-quotes')
    expect(record.kind).toBe(SpanKind.INTERNAL)
    expect(record.attribution).toEqual(ATTRIBUTION)
    expect(record.attributes['route']).toBe('quote')
    expect(record.attributes['mfe.definition.id']).toBe('operations-console')
    expect(typeof record.attributes['mfe.trace.id']).toBe('string')
    expect(typeof record.attributes['mfe.span.id']).toBe('string')
    expect(record.attributes['mfe.span.parent_id']).toBeUndefined()
    expect(span.isRecording()).toBe(true)
  })

  it('gives every span its own id and a fresh trace id at the root', () => {
    const { provider, tracer } = setup()
    tracer.startSpan('one')
    tracer.startSpan('two')

    const [first, second] = [at(provider.spans, 0), at(provider.spans, 1)]
    expect(first.attributes['mfe.span.id']).not.toBe(second.attributes['mfe.span.id'])
    expect(first.attributes['mfe.trace.id']).not.toBe(second.attributes['mfe.trace.id'])
  })

  it('honours kind, explicit start time and bounded names', () => {
    const { provider, tracer } = setup()

    tracer.startSpan('s'.repeat(400), { kind: SpanKind.CLIENT, startTime: 1234 })

    const record = at(provider.spans)
    expect(record.name).toHaveLength(256)
    expect(record.kind).toBe(SpanKind.CLIENT)
    expect(record.startTime).toBe(1234)
  })

  it('tracks open spans and releases them on end', () => {
    const { telemetry, tracer } = setup()

    const span = tracer.startSpan('load-quotes')
    expect(telemetry.openSpanCount).toBe(1)

    span.end()
    expect(telemetry.openSpanCount).toBe(0)
    expect(span.isRecording()).toBe(false)
  })
})

describe('span mutation', () => {
  it('records attributes, events, status and exceptions', () => {
    const { provider, tracer } = setup({ now: () => 500 })
    const failure = new Error('quote service unavailable')

    const span = tracer.startSpan('load-quotes')
    span
      .setAttribute('attempt', 2)
      .setAttributes({ route: 'quote', cached: false })
      .addEvent('cache.miss', { key: 'quotes' })
      .setStatus({ code: SpanStatusCode.ERROR, message: 'upstream failed' })
      .recordException(failure, { 'error.kind': 'upstream' })
    span.end(900)

    const record = at(provider.spans)
    expect(record.attributes['attempt']).toBe(2)
    expect(record.attributes['route']).toBe('quote')
    expect(record.attributes['cached']).toBe(false)
    expect(record.status).toEqual({ code: SpanStatusCode.ERROR, message: 'upstream failed' })
    expect(record.exceptions).toEqual([failure])
    expect(at(record.events).name).toBe('cache.miss')
    expect(at(record.events).attributes['key']).toBe('quotes')
    expect(at(record.events, 1).attributes['error.kind']).toBe('upstream')
    expect(record.endTime).toBe(900)
  })

  it('returns the framework span from every chainable member', () => {
    const { tracer } = setup()
    const span = tracer.startSpan('load-quotes')

    expect(span.setAttribute('a', 1)).toBe(span)
    expect(span.setAttributes({ b: 2 })).toBe(span)
    expect(span.addEvent('e')).toBe(span)
    expect(span.setStatus({ code: SpanStatusCode.OK })).toBe(span)
    expect(span.recordException(new Error('x'))).toBe(span)
  })

  it('refuses a reserved attribute key on a span', () => {
    const { provider, telemetry, tracer } = setup()
    const span = tracer.startSpan('load-quotes')
    const originalSpanId = at(provider.spans).attributes['mfe.span.id']

    span.setAttribute('mfe.span.id', 'forged')
    span.setAttributes({ 'mfe.definition.id': 'impersonated', route: 'quote' })

    const record = at(provider.spans)
    expect(record.attributes['mfe.span.id']).toBe(originalSpanId)
    expect(record.attributes['mfe.definition.id']).toBe('operations-console')
    expect(record.attributes['route']).toBe('quote')
    expect(telemetry.counters.reservedOverrideAttempts).toBe(2)
  })

  it('bounds span attribute values and drops a non-finite one', () => {
    const { provider, tracer } = setup()
    const span = tracer.startSpan('load-quotes')

    span.setAttribute('long', 'x'.repeat(2000))
    span.setAttribute('broken', Number.NaN)

    const record = at(provider.spans)
    expect(record.attributes['long']).toHaveLength(1024)
    expect(record.attributes['broken']).toBeUndefined()
  })
})

describe('ending a span', () => {
  it('treats repeated end() calls as harmless and keeps the first end time', () => {
    const { provider, tracer } = setup()
    const span = tracer.startSpan('load-quotes')

    span.end(100)
    span.end(200)
    span.end()

    expect(at(provider.spans).endTime).toBe(100)
    expect(span.isRecording()).toBe(false)
  })

  it('ignores every mutation after end, with a development diagnostic', () => {
    const { provider, diagnostics, telemetry, tracer } = setup()
    const span = tracer.startSpan('load-quotes')
    span.setStatus({ code: SpanStatusCode.OK })
    span.end(100)

    span.setAttribute('late', true)
    span.setAttributes({ later: true })
    span.addEvent('too-late')
    span.setStatus({ code: SpanStatusCode.ERROR, message: 'rewritten' })
    span.recordException(new Error('too late'))

    const record = at(provider.spans)
    expect(record.attributes['late']).toBeUndefined()
    expect(record.attributes['later']).toBeUndefined()
    expect(record.events).toHaveLength(0)
    expect(record.exceptions).toHaveLength(0)
    expect(record.status).toEqual({ code: SpanStatusCode.OK })
    expect(telemetry.counters.mutationsAfterEnd).toBe(5)
    expect(diagnostics.filter(d => d.error.message.includes('after it ended'))).toHaveLength(5)
  })
})

describe('startActiveSpan', () => {
  it('runs the callback exactly once and returns its value', () => {
    const { tracer } = setup()
    const callback = vi.fn((span: Span) => {
      span.end()
      return { ok: true }
    })

    const result = tracer.startActiveSpan('checkout', callback)

    expect(callback).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ ok: true })
  })

  it('accepts options before the callback', () => {
    const { provider, tracer } = setup()

    tracer.startActiveSpan('checkout', { kind: SpanKind.CLIENT, attributes: { a: 1 } }, span => {
      span.end()
    })

    const record = at(provider.spans)
    expect(record.kind).toBe(SpanKind.CLIENT)
    expect(record.attributes['a']).toBe(1)
  })

  it('does not end the span and does not record the exception when the callback throws', () => {
    const { provider, telemetry, tracer } = setup()
    const failure = new Error('checkout exploded')

    expect(() =>
      tracer.startActiveSpan('checkout', () => {
        throw failure
      }),
    ).toThrow(failure)

    const record = at(provider.spans)
    expect(record.endTime).toBeUndefined()
    expect(record.exceptions).toHaveLength(0)
    expect(record.status.code).toBe(SpanStatusCode.UNSET)
    expect(telemetry.openSpanCount).toBe(1)
  })

  it('preserves an asynchronous result', async () => {
    const { provider, tracer } = setup()

    const result = await tracer.startActiveSpan('checkout', async span => {
      await Promise.resolve()
      span.end()
      return 'resolved'
    })

    expect(result).toBe('resolved')
    expect(at(provider.spans).endTime).toBeDefined()
  })

  it('preserves an asynchronous rejection', async () => {
    const { tracer } = setup()
    const failure = new Error('rejected')

    await expect(
      tracer.startActiveSpan('checkout', async () => {
        await Promise.resolve()
        throw failure
      }),
    ).rejects.toBe(failure)
  })

  it('leaves the author in charge of the status', () => {
    const { provider, tracer } = setup()

    tracer.startActiveSpan('checkout', span => {
      span.setStatus({ code: SpanStatusCode.OK })
      span.end()
    })

    expect(at(provider.spans).status.code).toBe(SpanStatusCode.OK)
  })
})

describe('bounded open-span tracking', () => {
  it('refuses to start a span past the per-mount budget and hands back a non-recording handle', () => {
    const { provider, diagnostics, telemetry, tracer } = setup()

    const spans: Span[] = []
    for (let index = 0; index < TELEMETRY_LIMITS.maxOpenSpansPerMount; index += 1) {
      spans.push(tracer.startSpan(`span-${index}`))
    }
    expect(telemetry.openSpanCount).toBe(TELEMETRY_LIMITS.maxOpenSpansPerMount)

    const overflow = tracer.startSpan('one-too-many')

    expect(overflow.isRecording()).toBe(false)
    expect(provider.spansNamed('one-too-many')).toHaveLength(0)
    expect(telemetry.counters.spansDroppedAtLimit).toBe(1)
    expect(diagnostics.some(d => d.error.message.includes('one-too-many'))).toBe(true)

    at(spans).end()
    tracer.startSpan('room-again')
    expect(provider.spansNamed('room-again')).toHaveLength(1)
  })

  it('still runs a callback exactly once when the budget is exhausted', () => {
    const { tracer } = setup()
    for (let index = 0; index < TELEMETRY_LIMITS.maxOpenSpansPerMount; index += 1) {
      tracer.startSpan(`span-${index}`)
    }

    const callback = vi.fn(() => 'ran')
    expect(tracer.startActiveSpan('overflowing', callback)).toBe('ran')
    expect(callback).toHaveBeenCalledTimes(1)
  })
})

describe('disposal finalizes outstanding spans', () => {
  it('closes leaked spans as cancelled without turning them into failures', () => {
    const { provider, diagnostics, telemetry, tracer } = setup({ now: () => 4242 })
    tracer.startSpan('leaked-one')
    const second = tracer.startActiveSpan('leaked-two', span => {
      span.setStatus({ code: SpanStatusCode.OK })
      return span
    })
    expect(second.isRecording()).toBe(true)

    telemetry.dispose()

    const one = spanNamed(provider.spans, 'leaked-one')
    const two = spanNamed(provider.spans, 'leaked-two')
    expect(one.endTime).toBe(4242)
    expect(one.attributes['mfe.span.cancelled']).toBe(true)
    expect(one.attributes['mfe.span.end_reason']).toBe('mount-disposed')
    expect(one.status.code).toBe(SpanStatusCode.UNSET)
    expect(one.status.code).not.toBe(SpanStatusCode.ERROR)
    // A status the author set is preserved: cancellation does not overwrite it.
    expect(two.status.code).toBe(SpanStatusCode.OK)
    expect(two.attributes['mfe.span.cancelled']).toBe(true)

    expect(telemetry.counters.spansFinalizedAtDisposal).toBe(2)
    expect(telemetry.openSpanCount).toBe(0)
    expect(second.isRecording()).toBe(false)
    const leakDiagnostic = diagnostics.find(d => d.error.code === 'dispose/failure')
    expect(leakDiagnostic?.error.message).toContain('leaked-one')
    expect(leakDiagnostic?.context?.['openSpans']).toBe(2)
  })

  it('does not finalize a span the author already ended', () => {
    const { provider, telemetry, tracer } = setup()
    tracer.startSpan('done').end(10)

    telemetry.dispose()

    expect(at(provider.spans).endTime).toBe(10)
    expect(at(provider.spans).attributes['mfe.span.cancelled']).toBeUndefined()
    expect(telemetry.counters.spansFinalizedAtDisposal).toBe(0)
  })

  it('hands back non-recording spans after disposal but still runs callbacks once', () => {
    const { provider, telemetry, tracer } = setup()
    telemetry.dispose()

    const span = tracer.startSpan('after-dispose')
    const callback = vi.fn((active: Span) => {
      active.setAttribute('a', 1)
      active.end()
      return 'still ran'
    })
    const result = tracer.startActiveSpan('after-dispose-active', callback)

    expect(span.isRecording()).toBe(false)
    expect(result).toBe('still ran')
    expect(callback).toHaveBeenCalledTimes(1)
    expect(provider.spans).toHaveLength(0)
  })
})

describe('tracing switched off or broken', () => {
  it('never asks the provider for a tracer when tracing is disabled', () => {
    const { provider, tracer } = setup({ tracing: false })

    const span = tracer.startSpan('load-quotes')
    const result = tracer.startActiveSpan('checkout', active => {
      active.setStatus({ code: SpanStatusCode.OK })
      active.end()
      return 'ran'
    })

    expect(provider.tracerCount).toBe(0)
    expect(provider.spans).toHaveLength(0)
    expect(span.isRecording()).toBe(false)
    expect(result).toBe('ran')
  })

  it('contains a provider whose createTracer throws and keeps the mount alive', () => {
    const provider = createRecordingTelemetryProvider()
    provider.failTracerCreation(true)
    const telemetry = createMountTelemetry(provider, ATTRIBUTION, { dev: true })

    const result = telemetry.tracer.startActiveSpan('checkout', span => {
      span.end()
      return 'ran'
    })

    expect(result).toBe('ran')
    expect(telemetry.counters.sinkFailures).toBe(1)
    expect(telemetry.tracer.startSpan('anything').isRecording()).toBe(false)
    // Author telemetry still reaches the provider: only tracing is degraded.
    telemetry.event('checkout.started')
    expect(provider.events()).toHaveLength(1)
  })

  it('contains a span implementation that throws on every member', () => {
    const explode = (): never => {
      throw new Error('vendor span exploded')
    }
    const hostileSpan: Span = {
      setAttribute: explode,
      setAttributes: explode,
      addEvent: explode,
      setStatus: explode,
      recordException: explode,
      end: explode,
      isRecording: () => true,
    }
    const hostileTracer: Tracer = {
      startSpan: () => hostileSpan,
      startActiveSpan: (<T>(_name: string, callback: (span: Span) => T): T =>
        callback(hostileSpan)) as Tracer['startActiveSpan'],
    }
    const provider: TelemetryProvider = {
      record: () => {},
      createTracer: () => hostileTracer,
    }
    const telemetry = createMountTelemetry(provider, ATTRIBUTION, { dev: true })

    expect(() => {
      const span = telemetry.tracer.startSpan('load-quotes')
      span.setAttribute('a', 1)
      span.setAttributes({ b: 2 })
      span.addEvent('e')
      span.setStatus({ code: SpanStatusCode.OK })
      span.recordException(new Error('x'))
      span.end()
    }).not.toThrow()

    expect(telemetry.counters.sinkFailures).toBe(6)
    expect(telemetry.openSpanCount).toBe(0)
  })

  it('hands back a non-recording span when the provider tracer throws on startSpan', () => {
    const provider: TelemetryProvider = {
      record: () => {},
      createTracer: () => ({
        startSpan: () => {
          throw new Error('cannot start')
        },
        startActiveSpan: (<T>(_name: string, callback: (span: Span) => T): T =>
          callback(nonRecordingSpan)) as Tracer['startActiveSpan'],
      }),
    }
    const telemetry = createMountTelemetry(provider, ATTRIBUTION, { dev: true })

    const span = telemetry.tracer.startSpan('load-quotes')

    expect(span.isRecording()).toBe(false)
    expect(telemetry.counters.sinkFailures).toBe(1)
    expect(telemetry.counters.spansStarted).toBe(0)
  })
})
