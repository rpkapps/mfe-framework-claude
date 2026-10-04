/**
 * A named workflow, traced end to end: one trace for the workflow, a child span per step, an error
 * record linked to the trace when it fails, and a request that joins it only through `headers()`.
 */

import { describe, expect, it, vi } from 'vitest'

import { SpanStatusCode, type SpanRecord } from '@company/mfe-core'

import { createAuthenticatedFetch, type FetchLike } from '../auth/authenticated-fetch.ts'
import { at, setup, spanNamed } from './__tests__/harness.ts'

const API = 'https://api.example.test'

function idsOf(span: SpanRecord): { traceId: string; spanId: string } {
  if (span.spanContext === undefined) throw new Error(`span ${span.name} has no ids`)
  return span.spanContext
}

function traceparentOf(span: SpanRecord): string {
  const { traceId, spanId } = idsOf(span)
  return `00-${traceId}-${spanId}-01`
}

describe('a workflow', () => {
  it('is one object per name for the mount', () => {
    const { telemetry } = setup()

    expect(telemetry.workflow('checkout')).toBe(telemetry.workflow('checkout'))
    expect(telemetry.workflow('checkout')).not.toBe(telemetry.workflow('returns'))
    expect(Object.isFrozen(telemetry.workflow('checkout'))).toBe(true)
  })

  it('records a root span and one child span per step, each ending at the next', () => {
    const { provider, telemetry } = setup()
    const checkout = telemetry.workflow('checkout')

    checkout.start({ items: 3 })
    checkout.step('shipping chosen', { option: 'express' })
    const shippingEnded = spanNamed(provider.spans, 'shipping chosen').endTime
    checkout.step('place order')
    checkout.succeed({ total: 42 })

    const root = spanNamed(provider.spans, 'checkout')
    const shipping = spanNamed(provider.spans, 'shipping chosen')
    const order = spanNamed(provider.spans, 'place order')
    expect(shippingEnded).toBeUndefined()
    expect(provider.openSpans()).toHaveLength(0)
    expect(shipping.parent).toBe(root)
    expect(order.parent).toBe(root)
    expect(idsOf(shipping).traceId).toBe(idsOf(root).traceId)
    expect(idsOf(order).traceId).toBe(idsOf(root).traceId)
    expect(root.attributes).toMatchObject({ items: 3, total: 42 })
    expect(shipping.attributes['option']).toBe('express')
    expect(root.status.code).toBe(SpanStatusCode.OK)
  })

  it('starts a new trace for each run', () => {
    const { provider, telemetry } = setup()
    const checkout = telemetry.workflow('checkout')

    checkout.start()
    checkout.succeed()
    checkout.start()
    checkout.succeed()

    const [first, second] = provider.spansNamed('checkout')
    expect(first && idsOf(first).traceId).not.toBe(second && idsOf(second).traceId)
  })

  it('fails the current step and the workflow, and reports the error linked to the trace', () => {
    const { provider, telemetry } = setup()
    const checkout = telemetry.workflow('checkout')
    const failure = new Error('Order failed: 503')

    checkout.start()
    checkout.step('place order')
    checkout.fail(failure, { status: 503 })

    const root = spanNamed(provider.spans, 'checkout')
    const order = spanNamed(provider.spans, 'place order')
    for (const span of [root, order]) {
      expect(span.status.code).toBe(SpanStatusCode.ERROR)
      expect(span.exceptions).toEqual([failure])
      expect(span.endTime).toBeDefined()
    }
    expect(root.attributes['status']).toBe(503)

    const record = at(provider.logs('error'))
    expect(record.error).toBe(failure)
    expect(record.message).toBe('Order failed: 503')
    expect(record.attributes['status']).toBe(503)
    expect(record.spanContext).toEqual(idsOf(root))
  })

  it('abandons the open run when started again, without an error status', () => {
    const { provider, telemetry } = setup()
    const checkout = telemetry.workflow('checkout')

    checkout.start()
    checkout.step('shipping chosen')
    checkout.start()

    const [abandoned, current] = provider.spansNamed('checkout')
    const step = spanNamed(provider.spans, 'shipping chosen')
    for (const span of [abandoned, step]) {
      expect(span?.attributes['mfe.span.end_reason']).toBe('abandoned')
      expect(span?.status.code).toBe(SpanStatusCode.UNSET)
      expect(span?.endTime).toBeDefined()
    }
    expect(current?.endTime).toBeUndefined()
    expect(provider.logs('error')).toHaveLength(0)
  })

  it('ignores steps and ends while it is not open, but still reports a failure', () => {
    const { provider, diagnostics, telemetry } = setup()
    const checkout = telemetry.workflow('checkout')

    checkout.step('shipping chosen')
    checkout.succeed()
    checkout.start()
    checkout.succeed()
    const late = new Error('twice')
    checkout.fail(late)

    expect(provider.spans).toHaveLength(1)
    expect(provider.logs('error')).toHaveLength(1)
    expect(at(provider.logs('error')).error).toBe(late)
    expect(at(provider.logs('error'))).not.toHaveProperty('spanContext')
    expect(checkout.headers()).toEqual({})
    expect(diagnostics.filter(d => d.error.message.includes('which was not open'))).toHaveLength(3)
  })

  it('closes its open spans as cancelled when the mount is disposed', () => {
    const { provider, telemetry } = setup()
    const checkout = telemetry.workflow('checkout')
    checkout.start()
    checkout.step('place order')

    telemetry.dispose()
    checkout.succeed()

    for (const span of provider.spans) {
      expect(span.attributes['mfe.span.cancelled']).toBe(true)
      expect(span.attributes['mfe.span.end_reason']).toBe('mount-disposed')
      expect(span.status.code).toBe(SpanStatusCode.UNSET)
    }
    expect(checkout.headers()).toEqual({})
    expect(telemetry.counters.droppedAfterDispose).toBe(1)
    expect(telemetry.counters.mutationsAfterEnd).toBe(0)
  })
})

describe('workflow headers', () => {
  it('carry the workflow before its first step, then the current step', () => {
    const { provider, telemetry } = setup()
    const checkout = telemetry.workflow('checkout')

    checkout.start()
    const beforeStep = checkout.headers()
    checkout.step('place order')
    const duringStep = checkout.headers()

    expect(beforeStep).toEqual({
      traceparent: traceparentOf(spanNamed(provider.spans, 'checkout')),
    })
    expect(duringStep).toEqual({
      traceparent: traceparentOf(spanNamed(provider.spans, 'place order')),
    })
    expect(duringStep).not.toBe(checkout.headers())
  })

  it('are empty before the start and after the end', () => {
    const { telemetry } = setup()
    const checkout = telemetry.workflow('checkout')

    const before = checkout.headers()
    checkout.start()
    checkout.succeed()

    expect(before).toEqual({})
    expect(checkout.headers()).toEqual({})
  })
})

describe('a workflow with tracing off', () => {
  it('records no spans and sends no headers, but still reports a failure', () => {
    const { provider, telemetry } = setup({ tracing: false })
    const checkout = telemetry.workflow('checkout')
    const failure = new Error('Order failed: 503')

    checkout.start()
    checkout.step('place order')
    const headers = checkout.headers()
    checkout.fail(failure)

    expect(headers).toEqual({})
    expect(provider.spans).toHaveLength(0)
    const record = at(provider.logs('error'))
    expect(record.error).toBe(failure)
    expect(record).not.toHaveProperty('spanContext')
  })
})

describe('workflows with a key', () => {
  it('are one object per name and key, apart from the unkeyed one', () => {
    const { telemetry } = setup()

    expect(telemetry.workflow('upload', 'file-a')).toBe(telemetry.workflow('upload', 'file-a'))
    expect(telemetry.workflow('upload', 'file-a')).not.toBe(telemetry.workflow('upload', 'file-b'))
    expect(telemetry.workflow('upload', 'file-a')).not.toBe(telemetry.workflow('upload'))
    expect(telemetry.workflow('upload')).toBe(telemetry.workflow('upload'))
  })

  it('run independently while open at once, each in a trace of its own', () => {
    const { provider, telemetry } = setup()
    const first = telemetry.workflow('upload', 'file-a')
    const second = telemetry.workflow('upload', 'file-b')

    first.start()
    second.start()
    first.step('send')
    second.fail(new Error('Upload failed: 413'))
    first.succeed()

    const [a, b] = provider.spansNamed('upload')
    expect(a?.status.code).toBe(SpanStatusCode.OK)
    expect(b?.status.code).toBe(SpanStatusCode.ERROR)
    expect(a?.attributes['mfe.span.end_reason']).toBeUndefined()
    expect(a && idsOf(a).traceId).not.toBe(b && idsOf(b).traceId)
    expect(spanNamed(provider.spans, 'send').parent).toBe(a)
  })

  it('never record the key, and diagnose only that one was given', () => {
    const key = 'order-8812'
    const { provider, diagnostics, telemetry } = setup()
    const upload = telemetry.workflow('upload', key)

    upload.succeed()
    upload.start({ files: 1 })
    upload.step('send')
    upload.info('chunk sent')
    upload.fail(new Error('Upload failed'))

    const recorded = JSON.stringify([
      provider.records,
      provider.spans.map(span => [span.name, span.attributes]),
      diagnostics.map(diagnostic => [diagnostic.error.message, diagnostic.context]),
    ])
    expect(recorded).not.toContain(key)
    expect(at(diagnostics).error.message).toContain('workflow "upload" with a key')
  })
})

describe('records made through a workflow', () => {
  it('link to the current step, or the workflow before its first step', () => {
    const { provider, telemetry } = setup()
    const checkout = telemetry.workflow('checkout')

    checkout.start()
    checkout.info('cart loaded')
    checkout.step('quote')
    checkout.info('quote received', { carrier: 'post' })
    checkout.event('checkout.quoted')
    checkout.measure('checkout.quote.latency', 120, { unit: 'ms' })
    checkout.warn('quote is stale')
    checkout.debug('quote detail')
    checkout.error(new Error('Tax service slow'))
    checkout.succeed()

    const root = idsOf(spanNamed(provider.spans, 'checkout'))
    const quote = idsOf(spanNamed(provider.spans, 'quote'))
    const [loaded, ...duringStep] = provider.records
    expect(loaded?.spanContext).toEqual(root)
    expect(duringStep).toHaveLength(6)
    for (const record of duringStep) expect(record.spanContext).toEqual(quote)
    expect(at(provider.logs('info'), 1).attributes['carrier']).toBe('post')
    expect(at(provider.logs('error')).attributes['error.type']).toBe('Error')
    expect(at(provider.logs('error')).attribution).toEqual(at(provider.events()).attribution)
  })

  it('are still emitted, unlinked and without a diagnostic, while the workflow is not open', () => {
    const { provider, diagnostics, telemetry } = setup()
    const checkout = telemetry.workflow('checkout')

    checkout.info('before start')
    checkout.start()
    checkout.succeed()
    checkout.event('checkout.after')
    checkout.measure('checkout.after', 1, { unit: 'count' })

    expect(provider.records).toHaveLength(3)
    for (const record of provider.records) expect(record).not.toHaveProperty('spanContext')
    expect(diagnostics).toHaveLength(0)
  })

  it('are emitted unlinked with tracing off', () => {
    const { provider, telemetry } = setup({ tracing: false })
    const checkout = telemetry.workflow('checkout')

    checkout.start()
    checkout.step('quote')
    checkout.info('quote received')
    checkout.event('checkout.quoted')

    expect(provider.records).toHaveLength(2)
    for (const record of provider.records) expect(record).not.toHaveProperty('spanContext')
  })

  it('pass through the level filter like any record', () => {
    const { provider, telemetry } = setup()
    provider.setEnabledLevels(['info', 'warn', 'error'])
    const checkout = telemetry.workflow('checkout')

    checkout.start()
    checkout.debug('quote detail')
    checkout.info('quote received')

    expect(provider.logs('debug')).toHaveLength(0)
    expect(provider.logs('info')).toHaveLength(1)
    expect(telemetry.counters.droppedByLevelFilter).toBe(1)
  })

  it('are refused after the mount is disposed, like any record', () => {
    const { provider, telemetry } = setup()
    const checkout = telemetry.workflow('checkout')
    checkout.start()

    telemetry.dispose()
    checkout.info('quote received')
    checkout.event('checkout.quoted')
    checkout.measure('checkout.quote.latency', 120, { unit: 'ms' })
    checkout.error(new Error('late'))

    expect(provider.records).toHaveLength(0)
    expect(telemetry.counters.droppedAfterDispose).toBe(4)
  })
})

describe('a request sent with the workflow headers', () => {
  function api() {
    const sent: Headers[] = []
    const inner: FetchLike = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      sent.push(new Headers(init?.headers))
      return new Response('{}', { status: 200 })
    })
    const fetch = createAuthenticatedFetch({
      apiBaseUrl: `${API}/v1/`,
      allowedOrigins: [API],
      tokens: { getAccessToken: async () => 'token-1' },
      fetch: inner,
    })
    return { fetch, sent }
  }

  it('carries the step traceparent to a declared API beside the token', async () => {
    const { provider, telemetry } = setup()
    const { fetch, sent } = api()
    const checkout = telemetry.workflow('checkout')
    checkout.start()
    checkout.step('place order')

    await fetch('orders', { method: 'POST', headers: checkout.headers() })
    checkout.succeed()

    expect(at(sent).get('traceparent')).toBe(
      traceparentOf(spanNamed(provider.spans, 'place order')),
    )
    expect(at(sent).get('authorization')).toBe('Bearer token-1')
    expect(provider.spans).toHaveLength(2)
  })

  it('goes out with no trace context when the caller adds none', async () => {
    const { telemetry } = setup()
    const { fetch, sent } = api()
    telemetry.workflow('checkout').start()

    await fetch('orders')

    expect(at(sent).has('traceparent')).toBe(false)
  })
})
