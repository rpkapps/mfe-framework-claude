import { describe, expect, it, vi } from 'vitest'

import { SpanKind, SpanStatusCode, type Span, type TelemetryRecord } from '@company/mfe-core'

import { createRecordingTelemetryProvider } from './recording-provider.ts'
import { createMountTelemetry } from './service.ts'
import { createNonRecordingTracer, nonRecordingSpan } from './span-emitter.ts'
import { createNoopTelemetryProvider } from './tracer.ts'
import { at, ATTRIBUTION } from './__tests__/harness.ts'

function eventRecord(name: string): TelemetryRecord {
  return {
    kind: 'event',
    name,
    attributes: {},
    attribution: ATTRIBUTION,
    timestamp: 1,
  }
}

describe('the recording provider', () => {
  it('keeps every record and filters by kind, name and level', () => {
    const provider = createRecordingTelemetryProvider()
    const telemetry = createMountTelemetry(provider, ATTRIBUTION, { dev: true })

    telemetry.event('checkout.started')
    telemetry.event('checkout.completed')
    telemetry.info('quote requested')
    telemetry.warn('slow quote')
    telemetry.measure('checkout.latency', 12, { unit: 'ms' })
    telemetry.framework('mount', { message: 'mounted' })

    expect(provider.records).toHaveLength(6)
    expect(provider.events()).toHaveLength(2)
    expect(provider.events('checkout.started')).toHaveLength(1)
    expect(provider.logs()).toHaveLength(2)
    expect(provider.logs('warn')).toHaveLength(1)
    expect(provider.measurements('checkout.latency')).toHaveLength(1)
    expect(provider.measurements('nothing')).toHaveLength(0)
    expect(provider.frameworkRecords('mount')).toHaveLength(1)
  })

  it('exposes span lifecycles including status, events, exceptions and parentage', () => {
    const provider = createRecordingTelemetryProvider()
    const telemetry = createMountTelemetry(provider, ATTRIBUTION, { dev: true })
    const failure = new Error('quote failed')

    telemetry.tracer.startActiveSpan('checkout', outer => {
      telemetry.tracer.startActiveSpan('quote', { kind: SpanKind.CLIENT }, inner => {
        inner.addEvent('cache.miss')
        inner.recordException(failure)
        inner.setStatus({ code: SpanStatusCode.ERROR, message: 'quote failed' })
        inner.end()
      })
      outer.end()
    })

    expect(provider.spans).toHaveLength(2)
    expect(provider.spansNamed('quote')).toHaveLength(1)
    expect(provider.endedSpans()).toHaveLength(2)
    expect(provider.openSpans()).toHaveLength(0)

    const quote = at(provider.spansNamed('quote'))
    expect(quote.kind).toBe(SpanKind.CLIENT)
    expect(quote.parent?.name).toBe('checkout')
    expect(quote.exceptions).toEqual([failure])
    expect(quote.status.code).toBe(SpanStatusCode.ERROR)
    expect(quote.events.map(event => event.name)).toEqual(['cache.miss', 'exception'])
  })

  it('reports open spans until they end', () => {
    const provider = createRecordingTelemetryProvider()
    const telemetry = createMountTelemetry(provider, ATTRIBUTION, { dev: true })

    const span = telemetry.tracer.startSpan('in-flight')
    expect(provider.openSpans()).toHaveLength(1)
    span.end()
    expect(provider.openSpans()).toHaveLength(0)
    expect(provider.endedSpans()).toHaveLength(1)
  })

  it('bounds its buffers and counts the overflow', () => {
    const provider = createRecordingTelemetryProvider({ limit: 10 })

    for (let index = 0; index < 25; index += 1) provider.record(eventRecord(`e${index}`))

    expect(provider.records).toHaveLength(10)
    expect(provider.overflowCount).toBe(15)
    expect(at(provider.events()).name).toBe('e15')
  })

  it('clears records, spans and the overflow count', () => {
    const provider = createRecordingTelemetryProvider({ limit: 2 })
    provider.record(eventRecord('one'))
    provider.record(eventRecord('two'))
    provider.record(eventRecord('three'))
    const telemetry = createMountTelemetry(provider, ATTRIBUTION, { dev: true })
    telemetry.tracer.startSpan('span').end()

    provider.clear()

    expect(provider.records).toHaveLength(0)
    expect(provider.spans).toHaveLength(0)
    expect(provider.overflowCount).toBe(0)
  })

  it('can be told to fail records and tracer creation', () => {
    const provider = createRecordingTelemetryProvider()

    provider.failRecords(true)
    expect(() => provider.record(eventRecord('x'))).toThrow()
    provider.failRecords(record => record.kind === 'log')
    expect(() => provider.record(eventRecord('x'))).not.toThrow()

    provider.failTracerCreation(true)
    expect(() => provider.createTracer(ATTRIBUTION)).toThrow()
  })

  it('applies and clears a level filter', () => {
    const provider = createRecordingTelemetryProvider({ enabledLevels: ['error'] })
    expect(provider.isLevelEnabled?.('debug')).toBe(false)
    expect(provider.isLevelEnabled?.('error')).toBe(true)

    provider.setEnabledLevels(undefined)
    expect(provider.isLevelEnabled?.('debug')).toBe(true)
  })

  it('counts one tracer per mount', () => {
    const provider = createRecordingTelemetryProvider()
    createMountTelemetry(provider, ATTRIBUTION, { dev: true })
    createMountTelemetry(provider, ATTRIBUTION, { dev: true })
    createMountTelemetry(provider, ATTRIBUTION, { dev: true, tracing: false })

    expect(provider.tracerCount).toBe(2)
  })

  it('runs its own startActiveSpan callback exactly once', () => {
    const provider = createRecordingTelemetryProvider()
    const tracer = provider.createTracer(ATTRIBUTION)
    const callback = vi.fn((span: Span) => {
      span.end()
      return 'ran'
    })

    expect(tracer.startActiveSpan('direct', callback)).toBe('ran')
    expect(tracer.startActiveSpan('direct-with-options', { kind: SpanKind.SERVER }, callback)).toBe(
      'ran',
    )
    expect(callback).toHaveBeenCalledTimes(2)
    expect(provider.spans).toHaveLength(2)
  })
})

describe('the noop provider', () => {
  it('keeps nothing, disables every level and never throws', () => {
    const provider = createNoopTelemetryProvider()
    const telemetry = createMountTelemetry(provider, ATTRIBUTION, { dev: true })

    expect(provider.isLevelEnabled?.('error')).toBe(false)
    expect(() => {
      telemetry.event('checkout.started')
      telemetry.debug('debug')
      telemetry.error(new Error('ignored'))
      telemetry.measure('latency', 12, { unit: 'ms' })
    }).not.toThrow()

    expect(telemetry.counters.droppedByLevelFilter).toBe(2)
    expect(telemetry.counters.recorded).toBe(2)
  })

  it('hands out non-recording spans that still run callbacks once', () => {
    const provider = createNoopTelemetryProvider()
    const tracer = provider.createTracer(ATTRIBUTION)
    const callback = vi.fn((span: Span) => {
      span.setAttribute('a', 1).addEvent('e').setStatus({ code: SpanStatusCode.OK })
      span.end()
      return 'ran'
    })

    expect(tracer.startSpan('anything').isRecording()).toBe(false)
    expect(tracer.startActiveSpan('anything', callback)).toBe('ran')
    expect(tracer.startActiveSpan('anything', { kind: SpanKind.CLIENT }, callback)).toBe('ran')
    expect(callback).toHaveBeenCalledTimes(2)
  })
})

describe('the non-recording handle', () => {
  it('satisfies the whole span surface and stays chainable', () => {
    expect(nonRecordingSpan.setAttribute('a', 1)).toBe(nonRecordingSpan)
    expect(nonRecordingSpan.setAttributes({ a: 1 })).toBe(nonRecordingSpan)
    expect(nonRecordingSpan.addEvent('e')).toBe(nonRecordingSpan)
    expect(nonRecordingSpan.setStatus({ code: SpanStatusCode.OK })).toBe(nonRecordingSpan)
    expect(nonRecordingSpan.recordException(new Error('x'))).toBe(nonRecordingSpan)
    expect(nonRecordingSpan.isRecording()).toBe(false)
    expect(() => {
      nonRecordingSpan.end()
      nonRecordingSpan.end(10)
    }).not.toThrow()
  })

  it('returns a tracer whose spans never record', () => {
    const tracer = createNonRecordingTracer()
    expect(tracer.startSpan('x').isRecording()).toBe(false)
    expect(tracer.startActiveSpan('x', span => span.isRecording())).toBe(false)
  })
})
