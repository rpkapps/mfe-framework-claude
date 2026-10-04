import { beforeEach, describe, expect, it } from 'vitest'

import { SpanKind, SpanStatusCode, type TelemetryRecord } from '@company/mfe-core'

import { createRecordingTelemetryProvider } from '../testing/recording-provider.ts'
import { createMountTelemetry } from './service.ts'
import { createNonRecordingTracer } from './span-emitter.ts'
import { createNoopTelemetryProvider } from './tracer.ts'
import { at, ATTRIBUTION, resetPageWorkflows } from './__tests__/harness.ts'

beforeEach(resetPageWorkflows)

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
    provider.record({
      kind: 'framework',
      level: 'info',
      operation: 'mount',
      message: 'mounted',
      attributes: {},
      attribution: ATTRIBUTION,
      timestamp: 1,
    })

    expect(provider.records).toHaveLength(6)
    expect(provider.events()).toHaveLength(2)
    expect(provider.events('checkout.started')).toHaveLength(1)
    expect(provider.logs()).toHaveLength(2)
    expect(provider.logs('warn')).toHaveLength(1)
    expect(provider.measurements('checkout.latency')).toHaveLength(1)
    expect(provider.measurements('nothing')).toHaveLength(0)
    expect(provider.frameworkRecords('mount')).toHaveLength(1)
  })

  it('exposes span lifecycles including status, events and parentage', () => {
    const provider = createRecordingTelemetryProvider()
    const telemetry = createMountTelemetry(provider, ATTRIBUTION, { dev: true })
    const failure = new Error('quote failed')

    const checkout = telemetry.workflow('checkout')
    checkout.start()
    checkout.step('quote')
    checkout.fail(failure)

    expect(provider.spans).toHaveLength(2)
    expect(provider.spansNamed('quote')).toHaveLength(1)
    expect(provider.endedSpans()).toHaveLength(2)
    expect(provider.openSpans()).toHaveLength(0)

    const quote = at(provider.spansNamed('quote'))
    expect(quote.kind).toBe(SpanKind.INTERNAL)
    expect(quote.parent?.name).toBe('checkout')
    expect(quote.status.code).toBe(SpanStatusCode.ERROR)
    expect(quote.events.map(event => event.name)).toEqual(['exception'])
  })

  it('reports open spans until they end', () => {
    const provider = createRecordingTelemetryProvider()
    const telemetry = createMountTelemetry(provider, ATTRIBUTION, { dev: true })

    const checkout = telemetry.workflow('checkout')
    checkout.start()
    expect(provider.openSpans()).toHaveLength(1)
    checkout.succeed()
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
    telemetry.workflow('checkout').start()

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

    expect(provider.tracerCount).toBe(2)
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
  })

  it('hands out spans that never record', () => {
    const provider = createNoopTelemetryProvider()
    const tracer = provider.createTracer(ATTRIBUTION)

    expect(tracer.startSpan('anything')).toBe(createNonRecordingTracer().startSpan('other'))
  })
})

describe('the non-recording handle', () => {
  it('satisfies the whole span surface and stays chainable', () => {
    const nonRecordingSpan = createNonRecordingTracer().startSpan('x')
    expect(nonRecordingSpan.setAttributes({ a: 1 })).toBe(nonRecordingSpan)
    expect(nonRecordingSpan.setStatus({ code: SpanStatusCode.OK })).toBe(nonRecordingSpan)
    expect(nonRecordingSpan.recordException(new Error('x'))).toBe(nonRecordingSpan)
    expect(() => {
      nonRecordingSpan.end()
      nonRecordingSpan.end()
    }).not.toThrow()
  })

  it('returns a tracer whose spans are one shared handle, so they cost nothing', () => {
    const tracer = createNonRecordingTracer()
    expect(tracer.startSpan('x')).toBe(tracer.startSpan('y'))
  })
})
