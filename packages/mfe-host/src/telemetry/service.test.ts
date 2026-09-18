import { describe, expect, it, vi } from 'vitest'

import {
  SpanStatusCode,
  type Diagnostic,
  type MfeTelemetry,
  type TelemetryAttribution,
  type TelemetryProvider,
} from '@company/mfe-core'

import { createNonRecordingTracer } from './non-recording.ts'
import { createNoopTelemetryProvider } from './noop-provider.ts'
import { createRecordingTelemetryProvider } from './recording-provider.ts'
import { createMountTelemetry, type MountTelemetryOptions } from './service.ts'

const ATTRIBUTION: TelemetryAttribution = {
  definitionId: 'operations-console',
  definitionKind: 'app',
  definitionVersion: '2.4.1',
  buildHash: 'a1b2c3d4',
  mountToken: 'mount-7',
}

function at<T>(items: readonly T[], index = 0): T {
  const item = items[index]
  if (item === undefined) throw new Error(`expected an item at index ${index}`)
  return item
}

function setup(options: MountTelemetryOptions = {}) {
  const provider = createRecordingTelemetryProvider()
  const diagnostics: Diagnostic[] = []
  const telemetry = createMountTelemetry(provider, ATTRIBUTION, {
    dev: true,
    onDiagnostic: diagnostic => diagnostics.push(diagnostic),
    ...options,
  })
  return { provider, diagnostics, telemetry }
}

describe('the seven public members', () => {
  it('exposes exactly event, debug, info, warn, error, measure and tracer', () => {
    const { telemetry } = setup()

    expect(Object.keys(telemetry)).toEqual([
      'event',
      'debug',
      'info',
      'warn',
      'error',
      'measure',
      'tracer',
    ])
    for (const member of ['event', 'debug', 'info', 'warn', 'error', 'measure'] as const) {
      expect(typeof telemetry[member]).toBe('function')
    }
    expect(typeof telemetry.tracer.startSpan).toBe('function')
    expect(typeof telemetry.tracer.startActiveSpan).toBe('function')
  })

  it('keeps the service, its actions and the tracer stable for the mount lifetime', () => {
    const { telemetry } = setup()

    const event = telemetry.event
    const tracer = telemetry.tracer
    telemetry.event('first')
    telemetry.info('second')

    expect(telemetry.event).toBe(event)
    expect(telemetry.tracer).toBe(tracer)
    expect(telemetry.measure).toBe(telemetry.measure)
    expect(Object.isFrozen(telemetry)).toBe(true)
  })

  it('creates no subscriptions and returns nothing from an action', () => {
    const subscribe = vi.fn()
    const provider = {
      record: vi.fn(),
      createTracer: vi.fn(() => createNonRecordingTracer()),
      subscribe,
    } as unknown as TelemetryProvider

    const telemetry = createMountTelemetry(provider, ATTRIBUTION, { dev: true })

    expect(telemetry.event('checkout.started')).toBeUndefined()
    expect(telemetry.info('hello')).toBeUndefined()
    expect(subscribe).not.toHaveBeenCalled()
    for (const name of ['subscribe', 'on', 'addEventListener', 'addListener']) {
      expect(name in telemetry).toBe(false)
    }
  })

  it('delivers records synchronously, so no telemetry call awaits transport', () => {
    const { provider, telemetry } = setup()
    telemetry.event('checkout.started')
    // Already present the instant the call returns: nothing is queued on a task.
    expect(provider.records).toHaveLength(1)
  })
})

describe('the surface the framework does not have', () => {
  it('offers no time, trace, startTrace, fail or cancel convenience methods', () => {
    const { telemetry } = setup()

    for (const absent of ['time', 'trace', 'startTrace', 'fail', 'cancel', 'flush', 'span']) {
      expect(absent in telemetry).toBe(false)
      expect(absent in telemetry.tracer).toBe(false)
    }
    // The tracer is exactly startSpan and startActiveSpan.
    expect(typeof telemetry.tracer.startSpan).toBe('function')
    expect(typeof telemetry.tracer.startActiveSpan).toBe('function')
  })

  it('keeps the host controls off the enumerable author surface', () => {
    const { telemetry } = setup()

    // Present for the host that created the mount...
    expect(typeof telemetry.dispose).toBe('function')
    expect(typeof telemetry.framework).toBe('function')
    expect(telemetry.attribution).toEqual(ATTRIBUTION)
    // ...and invisible to anything that walks the author surface.
    for (const hostOnly of ['dispose', 'framework', 'counters', 'attribution', 'openSpanCount']) {
      expect(Object.keys(telemetry)).not.toContain(hostOnly)
    }
  })

  it('re-exports the binding from the directory index', async () => {
    const index = await import('./index.ts')

    expect(Object.keys(index).sort()).toEqual([
      'RESERVED_ATTRIBUTE_KEYS',
      'bindTelemetryContext',
      'createMountTelemetry',
      'createNonRecordingTracer',
      'createNoopTelemetryProvider',
      'createRecordingTelemetryProvider',
      'getActiveSpanContext',
      'isReservedAttributeKey',
      'nonRecordingSpan',
    ])
  })
})

describe('automatic attribution', () => {
  it('binds definition id, kind, version, build hash and mount token to every record', () => {
    const { provider, telemetry } = setup()

    telemetry.event('checkout.started', { step: 'address' })

    const record = at(provider.events('checkout.started'))
    expect(record.attribution).toEqual(ATTRIBUTION)
    expect(record.attributes).toEqual({
      step: 'address',
      'mfe.definition.id': 'operations-console',
      'mfe.definition.kind': 'app',
      'mfe.definition.version': '2.4.1',
      'mfe.build.hash': 'a1b2c3d4',
      'mfe.mount.token': 'mount-7',
    })
  })

  it('omits attribution fields the host did not supply', () => {
    const provider = createRecordingTelemetryProvider()
    const telemetry = createMountTelemetry(
      provider,
      { definitionId: 'alert-panel', definitionKind: 'widget' },
      { dev: true },
    )

    telemetry.info('ready')

    const record = at(provider.logs('info'))
    expect(record.attribution).toEqual({ definitionId: 'alert-panel', definitionKind: 'widget' })
    expect(record.attributes).toEqual({
      'mfe.definition.id': 'alert-panel',
      'mfe.definition.kind': 'widget',
    })
  })

  it('copies the attribution, so a later mutation cannot rewrite emitted records', () => {
    const mutable = { ...ATTRIBUTION } as { definitionId: string; definitionKind: 'app' }
    const provider = createRecordingTelemetryProvider()
    const telemetry = createMountTelemetry(provider, mutable as TelemetryAttribution, { dev: true })

    telemetry.event('before')
    mutable.definitionId = 'someone-else'

    expect(at(provider.events()).attribution.definitionId).toBe('operations-console')
    telemetry.event('after')
    expect(at(provider.events(), 1).attribution.definitionId).toBe('operations-console')
  })

  it('makes an author attribute lose against a reserved attribution key', () => {
    const { provider, diagnostics, telemetry } = setup()

    telemetry.event('checkout.started', {
      'mfe.definition.id': 'impersonated',
      'mfe.span.id': 'forged',
      keep: 'this',
    })

    const record = at(provider.events())
    expect(record.attributes['mfe.definition.id']).toBe('operations-console')
    expect(record.attributes['mfe.span.id']).toBeUndefined()
    expect(record.attributes['keep']).toBe('this')
    expect(telemetry.counters.reservedOverrideAttempts).toBe(2)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics).error.message).toContain('mfe.definition.id')
  })

  it('keeps attribution even when the author sends a full budget of attributes', () => {
    const { provider, telemetry } = setup()
    const attributes: Record<string, number> = {}
    for (let index = 0; index < 80; index += 1) attributes[`a${index}`] = index

    telemetry.event('bulk', attributes)

    const record = at(provider.events())
    // 64 author attributes survive the clamp, and the five reserved keys are
    // merged afterwards so they can never be crowded out.
    expect(Object.keys(record.attributes)).toHaveLength(69)
    expect(record.attributes['a0']).toBe(0)
    expect(record.attributes['a63']).toBe(63)
    expect(record.attributes['a64']).toBeUndefined()
    expect(record.attributes['mfe.definition.id']).toBe('operations-console')
  })
})

describe('bounded names and attribute values', () => {
  it('truncates a name beyond the documented limit', () => {
    const { provider, telemetry } = setup()
    telemetry.event('e'.repeat(400))
    expect(at(provider.events()).name).toHaveLength(256)
  })

  it('truncates a long string attribute and drops a non-finite one', () => {
    const { provider, telemetry } = setup()

    telemetry.event('bounded', { long: 'x'.repeat(2000), broken: Number.NaN, fine: true })

    const attributes = at(provider.events()).attributes
    expect(attributes['long']).toHaveLength(1024)
    expect(attributes['broken']).toBeUndefined()
    expect(attributes['fine']).toBe(true)
  })

  it('truncates a long log message', () => {
    const { provider, telemetry } = setup()
    telemetry.warn('w'.repeat(500))
    expect(at(provider.logs('warn')).message).toHaveLength(256)
  })
})

describe('logs and levels', () => {
  it('records debug, info and warn at their own level', () => {
    const { provider, telemetry } = setup()

    telemetry.debug('debug message', { a: 1 })
    telemetry.info('info message')
    telemetry.warn('warn message')

    expect(provider.logs().map(log => log.level)).toEqual(['debug', 'info', 'warn'])
    expect(at(provider.logs('debug')).attributes['a']).toBe(1)
  })

  it('reports an error without throwing it and keeps the original value', () => {
    const { provider, telemetry } = setup()
    const failure = new TypeError('quote service unavailable')

    expect(() => telemetry.error(failure, { retry: 2 })).not.toThrow()

    const record = at(provider.logs('error'))
    expect(record.message).toBe('quote service unavailable')
    expect(record.error).toBe(failure)
    expect(record.attributes['error.type']).toBe('TypeError')
    expect(record.attributes['retry']).toBe(2)
  })

  it('normalizes a thrown non-error', () => {
    const { provider, telemetry } = setup()
    telemetry.error('just a string')
    const record = at(provider.logs('error'))
    expect(record.message).toBe('just a string')
    expect(record.attributes['error.type']).toBe('NonError')
  })

  it('honours the provider level filter, including switching debug collection off', () => {
    const { provider, telemetry } = setup()
    provider.setEnabledLevels(['warn', 'error'])

    telemetry.debug('dropped')
    telemetry.info('dropped')
    telemetry.warn('kept')

    expect(provider.logs().map(log => log.message)).toEqual(['kept'])
    expect(telemetry.counters.droppedByLevelFilter).toBe(2)
  })

  it('records everything when the provider declares no level filter', () => {
    const record = vi.fn()
    const provider: TelemetryProvider = { record, createTracer: () => createNonRecordingTracer() }
    const telemetry = createMountTelemetry(provider, ATTRIBUTION, { dev: true })

    telemetry.debug('kept')
    telemetry.info('kept')

    expect(record).toHaveBeenCalledTimes(2)
  })

  it('contains a level filter that throws and still delivers the record', () => {
    const provider = createRecordingTelemetryProvider()
    const broken: TelemetryProvider = {
      record: record => provider.record(record),
      createTracer: attribution => provider.createTracer(attribution),
      isLevelEnabled: () => {
        throw new Error('filter exploded')
      },
    }
    const telemetry = createMountTelemetry(broken, ATTRIBUTION, { dev: true })

    expect(() => telemetry.info('still important')).not.toThrow()
    expect(provider.logs('info')).toHaveLength(1)
    expect(telemetry.counters.sinkFailures).toBe(1)
  })

  it('does not filter events or measurements, which carry no level', () => {
    const { provider, telemetry } = setup()
    provider.setEnabledLevels([])

    telemetry.event('checkout.started')
    telemetry.measure('checkout.latency', 12, { unit: 'ms' })

    expect(provider.events()).toHaveLength(1)
    expect(provider.measurements()).toHaveLength(1)
  })
})

describe('measurements', () => {
  it('records one finite observation with its unit and attributes', () => {
    const { provider, telemetry } = setup({ now: () => 1700 })

    telemetry.measure('checkout.latency', 128.5, { unit: 'ms', attributes: { route: 'quote' } })

    const record = at(provider.measurements('checkout.latency'))
    expect(record).toMatchObject({ kind: 'measurement', value: 128.5, unit: 'ms', timestamp: 1700 })
    expect(record.attributes['route']).toBe('quote')
    expect(record.attributes['mfe.definition.id']).toBe('operations-console')
  })

  it('accepts zero and negative observations and every documented unit', () => {
    const { provider, telemetry } = setup()

    telemetry.measure('drift', 0, { unit: 'count' })
    telemetry.measure('delta', -17, { unit: 'bytes' })

    expect(provider.measurements().map(measurement => measurement.value)).toEqual([0, -17])
    expect(provider.measurements().map(measurement => measurement.unit)).toEqual(['count', 'bytes'])
  })

  it('ignores a non-finite observation with a development diagnostic', () => {
    const { provider, diagnostics, telemetry } = setup()

    telemetry.measure('broken', Number.NaN, { unit: 'ms' })
    telemetry.measure('broken', Number.POSITIVE_INFINITY, { unit: 'ms' })
    telemetry.measure('broken', Number.NEGATIVE_INFINITY, { unit: 'ms' })

    expect(provider.measurements()).toHaveLength(0)
    expect(telemetry.counters.invalidMeasurements).toBe(3)
    expect(diagnostics).toHaveLength(3)
    expect(at(diagnostics).error.message).toContain('finite')
    expect(at(diagnostics).severity).toBe('warning')
  })

  it('stays silent about invalid measurements outside development', () => {
    const provider = createRecordingTelemetryProvider()
    const diagnostics: Diagnostic[] = []
    const telemetry = createMountTelemetry(provider, ATTRIBUTION, {
      dev: false,
      onDiagnostic: diagnostic => diagnostics.push(diagnostic),
    })

    telemetry.measure('broken', Number.NaN, { unit: 'ms' })

    expect(diagnostics).toHaveLength(0)
    expect(telemetry.counters.invalidMeasurements).toBe(1)
  })
})

describe('provider failures are contained', () => {
  it('swallows a throwing provider, counts it, and keeps working afterwards', () => {
    const { provider, diagnostics, telemetry } = setup()
    provider.failRecords(true)

    expect(() => telemetry.event('checkout.started')).not.toThrow()
    expect(provider.records).toHaveLength(0)
    expect(telemetry.counters.sinkFailures).toBe(1)
    expect(telemetry.counters.recorded).toBe(0)
    expect(at(diagnostics).error.code).toBe('config/invalid')

    provider.failRecords(false)
    telemetry.event('checkout.completed')
    expect(provider.events('checkout.completed')).toHaveLength(1)
    expect(telemetry.counters.recorded).toBe(1)
  })

  it('contains a provider that fails only for some records', () => {
    const { provider, telemetry } = setup()
    provider.failRecords(record => record.kind === 'measurement')

    telemetry.event('kept')
    telemetry.measure('dropped', 1, { unit: 'count' })

    expect(provider.events()).toHaveLength(1)
    expect(provider.measurements()).toHaveLength(0)
    expect(telemetry.counters.sinkFailures).toBe(1)
  })

  it('bounds the diagnostic budget and counts what it withheld', () => {
    const { diagnostics, telemetry } = setup({ maxDiagnostics: 3 })

    for (let index = 0; index < 10; index += 1) {
      telemetry.measure('broken', Number.NaN, { unit: 'ms' })
    }

    expect(diagnostics).toHaveLength(3)
    expect(telemetry.counters.diagnosticsEmitted).toBe(3)
    expect(telemetry.counters.diagnosticsSuppressed).toBe(7)
    expect(telemetry.counters.invalidMeasurements).toBe(10)
  })

  it('counts a throwing diagnostics sink without reporting it through itself', () => {
    const provider = createRecordingTelemetryProvider()
    const sink = vi.fn(() => {
      throw new Error('sink exploded')
    })
    const telemetry = createMountTelemetry(provider, ATTRIBUTION, { dev: true, onDiagnostic: sink })

    expect(() => telemetry.measure('broken', Number.NaN, { unit: 'ms' })).not.toThrow()

    // Exactly one attempt: the failure of the sink is never itself reported.
    expect(sink).toHaveBeenCalledTimes(1)
    expect(telemetry.counters.sinkFailures).toBe(1)
    expect(telemetry.counters.diagnosticsEmitted).toBe(1)
  })
})

describe('framework records and error deduplication', () => {
  it('emits a framework record that stays distinguishable from author telemetry', () => {
    const { provider, telemetry } = setup()

    telemetry.framework('mount', { message: 'mounted in 42ms', attributes: { attempt: 1 } })

    const record = at(provider.frameworkRecords('mount'))
    expect(record.kind).toBe('framework')
    expect(record.level).toBe('info')
    expect(record.message).toBe('mounted in 42ms')
    expect(record.attributes['attempt']).toBe(1)
    expect(provider.logs()).toHaveLength(0)
  })

  it('records a repeated author report but counts the duplicate', () => {
    const { provider, telemetry } = setup()
    const failure = new Error('quote service unavailable')

    telemetry.error(failure)
    telemetry.error(failure)

    // The author asked twice: both are recorded, because a retry loop reporting
    // the same instance is meaningful. The duplication is counted, not hidden.
    expect(provider.logs('error')).toHaveLength(2)
    expect(telemetry.counters.duplicateErrorReports).toBe(1)
  })

  it('drops a framework report of an error the author already reported', () => {
    const { provider, telemetry } = setup()
    const failure = new Error('quote service unavailable')

    telemetry.error(failure)
    telemetry.framework('mount', { level: 'error', message: 'mount failed', error: failure })

    expect(provider.logs('error')).toHaveLength(1)
    expect(provider.frameworkRecords()).toHaveLength(0)
    expect(telemetry.counters.deduplicatedErrors).toBe(1)
  })

  it('records a framework report of an error nobody has reported yet', () => {
    const { provider, telemetry } = setup()
    const failure = new Error('load failed')

    telemetry.framework('load', { level: 'error', message: 'entry failed', error: failure })
    telemetry.framework('load', { level: 'error', message: 'entry failed', error: failure })

    expect(provider.frameworkRecords()).toHaveLength(1)
    expect(telemetry.counters.deduplicatedErrors).toBe(1)
  })

  it('cannot deduplicate a non-object error and records both', () => {
    const { provider, telemetry } = setup()

    telemetry.error('string failure')
    telemetry.framework('mount', {
      level: 'error',
      message: 'mount failed',
      error: 'string failure',
    })

    expect(provider.logs('error')).toHaveLength(1)
    expect(provider.frameworkRecords()).toHaveLength(1)
    expect(telemetry.counters.deduplicatedErrors).toBe(0)
  })
})

describe('disposal', () => {
  it('stops accepting new records and counts what it dropped', () => {
    const { provider, diagnostics, telemetry } = setup()
    telemetry.event('before')

    telemetry.dispose()
    telemetry.event('after')
    telemetry.info('after')
    telemetry.measure('after', 1, { unit: 'count' })
    telemetry.framework('dispose', { message: 'after' })

    expect(telemetry.disposed).toBe(true)
    expect(provider.records).toHaveLength(1)
    expect(at(provider.events()).name).toBe('before')
    expect(telemetry.counters.droppedAfterDispose).toBe(4)
    expect(diagnostics.every(diagnostic => diagnostic.error.code === 'dispose/failure')).toBe(true)
  })

  it('keeps the original attribution on records accepted before disposal', () => {
    const { provider, telemetry } = setup()
    telemetry.event('before', { step: 'address' })

    telemetry.dispose()

    const record = at(provider.events())
    expect(record.attribution).toEqual(ATTRIBUTION)
    expect(record.attributes['mfe.mount.token']).toBe('mount-7')
  })

  it('is idempotent', () => {
    const { telemetry } = setup()
    telemetry.dispose()
    expect(() => telemetry.dispose()).not.toThrow()
    expect(telemetry.counters.droppedAfterDispose).toBe(0)
  })

  it('leaves the tracer usable as a non-recording handle', () => {
    const { provider, telemetry } = setup()
    telemetry.dispose()

    const span = telemetry.tracer.startSpan('after')
    span.setAttribute('a', 1).setStatus({ code: SpanStatusCode.OK }).end()

    expect(span.isRecording()).toBe(false)
    expect(provider.spans).toHaveLength(0)
  })
})

describe('provider replacement', () => {
  // The same author code, unchanged, against three different providers.
  function authorFeature(telemetry: MfeTelemetry): string {
    telemetry.event('checkout.started', { step: 'address' })
    telemetry.measure('checkout.latency', 42, { unit: 'ms' })
    telemetry.info('quote requested')
    return telemetry.tracer.startActiveSpan('checkout', span => {
      span.setAttribute('checkout.step', 'quote')
      span.setStatus({ code: SpanStatusCode.OK })
      span.end()
      return 'done'
    })
  }

  it('runs identically against two recording providers and a noop provider', () => {
    const first = createRecordingTelemetryProvider()
    const second = createRecordingTelemetryProvider()
    const noop = createNoopTelemetryProvider()

    const results = [first, second, noop].map(provider => {
      const telemetry = createMountTelemetry(provider, ATTRIBUTION, { dev: true })
      const result = authorFeature(telemetry)
      telemetry.dispose()
      return result
    })

    expect(results).toEqual(['done', 'done', 'done'])
    for (const provider of [first, second]) {
      expect(provider.events('checkout.started')).toHaveLength(1)
      expect(provider.measurements('checkout.latency')).toHaveLength(1)
      expect(provider.logs('info')).toHaveLength(1)
      expect(at(provider.spansNamed('checkout')).status.code).toBe(SpanStatusCode.OK)
    }
    // The noop provider kept nothing and the author code could not tell.
    expect(first.records).toHaveLength(3)
    expect(second.records).toHaveLength(3)
  })

  it('carries a different attribution per mount against one shared provider', () => {
    const provider = createRecordingTelemetryProvider()
    const app = createMountTelemetry(provider, ATTRIBUTION, { dev: true })
    const widget = createMountTelemetry(
      provider,
      { definitionId: 'alert-panel', definitionKind: 'widget', mountToken: 'mount-9' },
      { dev: true },
    )

    app.event('from-app')
    widget.event('from-widget')

    expect(at(provider.events('from-app')).attribution.definitionId).toBe('operations-console')
    expect(at(provider.events('from-widget')).attribution.definitionId).toBe('alert-panel')
    expect(at(provider.events('from-widget')).attributes['mfe.mount.token']).toBe('mount-9')
  })
})
