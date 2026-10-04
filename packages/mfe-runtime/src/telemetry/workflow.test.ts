/**
 * One workflow, traced end to end: a span kept across clicks, children that join it through
 * `withSpan`, records linked to the active span, and a request through the framework's fetch
 * that carries the trace to the backend as `traceparent`.
 */

import { describe, expect, it, vi } from 'vitest'

import { SpanKind, SpanStatusCode, type SpanRecord } from '@company/mfe-core'

import { createAuthenticatedFetch, type FetchLike } from '../auth/authenticated-fetch.ts'
import { getActiveSpanContext } from './active-span.ts'
import { at, setup, spanNamed } from './__tests__/harness.ts'

const API = 'https://api.example.test'

function idsOf(span: SpanRecord): { traceId: string; spanId: string } {
  if (span.spanContext === undefined) throw new Error(`span ${span.name} has no ids`)
  return span.spanContext
}

/** The framework's fetch over a recording inner fetch, answering every attempt with `respond`. */
function api(respond: (attempt: number) => Response | Promise<Response> = () => ok()) {
  const sent: Headers[] = []
  const inner: FetchLike = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    sent.push(new Headers(init?.headers))
    return await respond(sent.length)
  })
  let token = 0
  const fetch = createAuthenticatedFetch({
    apiBaseUrl: `${API}/v1/`,
    allowedOrigins: [API],
    tokens: { getAccessToken: async () => `token-${String((token += 1))}` },
    fetch: inner,
  })
  return { fetch, sent }
}

function ok(): Response {
  return new Response('{}', { status: 200 })
}

describe('tracer.withSpan', () => {
  it('parents work on a later click under a span kept from an earlier one', () => {
    const { provider, tracer } = setup()

    const workflow = tracer.startSpan('checkout')
    // A later event handler: nothing is active until the span is made active again.
    tracer.withSpan(workflow, () => {
      tracer.startSpan('checkout.shipping').end()
    })
    workflow.end()

    const checkout = spanNamed(provider.spans, 'checkout')
    const shipping = spanNamed(provider.spans, 'checkout.shipping')
    expect(shipping.parent).toBe(checkout)
    expect(shipping.parentSpanId).toBe(idsOf(checkout).spanId)
    expect(idsOf(shipping).traceId).toBe(idsOf(checkout).traceId)
  })

  it('continues the trace after an await, where the ambient context is gone', async () => {
    const { provider, tracer } = setup()

    const workflow = tracer.startSpan('checkout')
    await Promise.resolve()
    tracer.withSpan(workflow, () => tracer.startSpan('after-await').end())
    workflow.end()

    expect(spanNamed(provider.spans, 'after-await').parent).toBe(
      spanNamed(provider.spans, 'checkout'),
    )
  })

  it('returns what the work returns and restores the previous context on a throw', () => {
    const { tracer } = setup()
    const workflow = tracer.startSpan('checkout')

    expect(tracer.withSpan(workflow, () => 42)).toBe(42)
    expect(() =>
      tracer.withSpan(workflow, () => {
        throw new Error('step failed')
      }),
    ).toThrow('step failed')
    expect(getActiveSpanContext()).toBeUndefined()
    workflow.end()
  })

  it('still parents under a span that has already ended', () => {
    const { provider, tracer } = setup()

    const workflow = tracer.startSpan('checkout')
    workflow.end()
    tracer.withSpan(workflow, () => tracer.startSpan('late-step').end())

    expect(spanNamed(provider.spans, 'late-step').parent).toBe(
      spanNamed(provider.spans, 'checkout'),
    )
  })

  it("does not adopt another mount's span, so the work starts a trace of its own", () => {
    const orders = setup()
    const billing = setup({}, { definitionId: 'billing', definitionKind: 'widget' })

    const foreign = orders.tracer.startSpan('checkout')
    const result = billing.tracer.withSpan(foreign, () => {
      billing.tracer.startSpan('invoice').end()
      return 'ran'
    })
    foreign.end()

    expect(result).toBe('ran')
    expect(spanNamed(billing.provider.spans, 'invoice').parent).toBeUndefined()
    expect(spanNamed(billing.provider.spans, 'invoice').parentSpanId).toBeUndefined()
  })

  it('runs the work unchanged for a span that does not record', () => {
    const { provider, tracer } = setup({ tracing: false })

    const span = tracer.startSpan('checkout')

    expect(tracer.withSpan(span, () => 'ran')).toBe('ran')
    expect(provider.spans).toHaveLength(0)
  })
})

describe('records made inside a span', () => {
  it('carry the active span, so a backend can link them to it', () => {
    const { provider, telemetry, tracer } = setup()

    tracer.startActiveSpan('checkout', span => {
      telemetry.event('checkout.address-entered')
      telemetry.info('quote requested')
      telemetry.error(new Error('quote failed'))
      telemetry.measure('quote.duration', 12, { unit: 'ms' })
      span.end()
    })

    const ids = idsOf(spanNamed(provider.spans, 'checkout'))
    expect(provider.records).toHaveLength(4)
    for (const record of provider.records) expect(record.spanContext).toEqual(ids)
  })

  it('carry nothing outside a span', () => {
    const { provider, telemetry } = setup()

    telemetry.event('page.viewed')

    expect(at(provider.records)).not.toHaveProperty('spanContext')
  })

  it("are not linked to another mount's active span", () => {
    const orders = setup()
    const billing = setup({}, { definitionId: 'billing', definitionKind: 'widget' })

    orders.tracer.startActiveSpan('checkout', span => {
      billing.telemetry.event('invoice.previewed')
      span.end()
    })

    expect(at(billing.provider.records)).not.toHaveProperty('spanContext')
  })
})

describe('a request through the framework fetch', () => {
  it('sends traceparent for a client span that is a child of the workflow', async () => {
    const { provider, tracer } = setup()
    const { fetch, sent } = api()

    const workflow = tracer.startSpan('checkout')
    const response = await tracer.withSpan(workflow, () => fetch('orders', { method: 'post' }))
    workflow.end()

    const checkout = spanNamed(provider.spans, 'checkout')
    const request = spanNamed(provider.spans, 'POST')
    const { traceId, spanId } = idsOf(request)
    expect(response.status).toBe(200)
    expect(at(sent).get('traceparent')).toBe(`00-${traceId}-${spanId}-01`)
    expect(traceId).toBe(idsOf(checkout).traceId)
    expect(request.parent).toBe(checkout)
    expect(request.kind).toBe(SpanKind.CLIENT)
    expect(request.endTime).toBeDefined()
    expect(request.attributes).toMatchObject({
      'http.request.method': 'POST',
      'server.address': 'api.example.test',
      'server.port': 443,
      'http.response.status_code': 200,
    })
  })

  it('never records the path or the query, which can carry ids', async () => {
    const { provider, tracer } = setup()
    const { fetch } = api()

    await tracer.startActiveSpan('lookup', async span => {
      await fetch('customers/c-1234?email=someone%40example.test')
      span.end()
    })

    const values = Object.values(spanNamed(provider.spans, 'GET').attributes).map(String)
    expect(values.some(value => value.includes('c-1234') || value.includes('email'))).toBe(false)
  })

  it('marks the client span as an error for a 4xx or 5xx answer', async () => {
    const { provider, tracer } = setup()
    const { fetch } = api(() => new Response('', { status: 503 }))

    await tracer.startActiveSpan('checkout', async span => {
      await fetch('orders')
      span.end()
    })

    expect(spanNamed(provider.spans, 'GET').status).toEqual({
      code: SpanStatusCode.ERROR,
      message: '503',
    })
  })

  it('records a network failure on the client span and still rejects', async () => {
    const { provider, tracer } = setup()
    const { fetch } = api(() => Promise.reject(new TypeError('Failed to fetch')))

    await tracer.startActiveSpan('checkout', async span => {
      await expect(fetch('orders')).rejects.toThrow('Failed to fetch')
      span.end()
    })

    const request = spanNamed(provider.spans, 'GET')
    expect(request.status.code).toBe(SpanStatusCode.ERROR)
    expect(request.exceptions).toHaveLength(1)
    expect(request.endTime).toBeDefined()
  })

  it('keeps one client span and one traceparent across the retry after a 401', async () => {
    const { provider, tracer } = setup()
    const { fetch, sent } = api(attempt =>
      attempt === 1 ? new Response('', { status: 401 }) : ok(),
    )

    await tracer.startActiveSpan('checkout', async span => {
      await fetch('orders')
      span.end()
    })

    expect(sent).toHaveLength(2)
    expect(at(sent, 1).get('traceparent')).toBe(at(sent).get('traceparent'))
    expect(provider.spansNamed('GET')).toHaveLength(1)
    expect(spanNamed(provider.spans, 'GET').attributes).toMatchObject({
      'http.request.resend_count': 1,
      'http.response.status_code': 200,
    })
  })

  it('leaves the client span alone when the mount went away while the request was out', async () => {
    const { provider, telemetry, tracer, diagnostics } = setup()
    let answer: (response: Response) => void = () => {}
    const { fetch } = api(
      () =>
        new Promise<Response>(resolve => {
          answer = resolve
        }),
    )

    const pending = tracer.startActiveSpan('checkout', span => {
      const request = fetch('orders')
      span.end()
      return request
    })
    await Promise.resolve()
    telemetry.dispose()
    answer(ok())
    await pending

    expect(spanNamed(provider.spans, 'GET').attributes).toMatchObject({
      'mfe.span.cancelled': true,
    })
    expect(telemetry.counters.mutationsAfterEnd).toBe(0)
    expect(diagnostics.filter(d => d.error.message.includes('after it ended'))).toHaveLength(0)
  })

  it('goes out untraced when no span is active', async () => {
    const { provider } = setup()
    const { fetch, sent } = api()

    await fetch('orders')

    expect(at(sent).has('traceparent')).toBe(false)
    expect(provider.spans).toHaveLength(0)
  })

  it('leaves a traceparent the caller set alone', async () => {
    const { provider, tracer } = setup()
    const { fetch, sent } = api()
    const own = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'

    await tracer.startActiveSpan('checkout', async span => {
      await fetch('orders', { headers: { traceparent: own } })
      span.end()
    })

    expect(at(sent).get('traceparent')).toBe(own)
    expect(provider.spansNamed('GET')).toHaveLength(0)
  })

  it('sends no trace context to an origin that is not a declared API', async () => {
    const { provider, tracer } = setup()
    const { fetch, sent } = api()

    await tracer.startActiveSpan('checkout', async span => {
      await fetch('https://analytics.vendor.test/collect')
      span.end()
    })

    expect(at(sent).has('traceparent')).toBe(false)
    expect(provider.spansNamed('GET')).toHaveLength(0)
  })

  it('goes out untraced when tracing is off for the mount', async () => {
    const { tracer } = setup({ tracing: false })
    const { fetch, sent } = api()

    await tracer.startActiveSpan('checkout', async span => {
      await fetch('orders')
      span.end()
    })

    // A span that does not record is never made active, so there is no trace to join.
    expect(at(sent).has('traceparent')).toBe(false)
  })
})
