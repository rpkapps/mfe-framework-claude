/**
 * A named workflow, traced end to end: one trace for the workflow, a child span per step, an error
 * record linked to the trace when it fails, and a request that joins it only through `headers()`.
 * The run is the page's, so every mount that names it takes part in the same trace.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SpanStatusCode, type SpanRecord, type TelemetryAttribution } from '@company/mfe-core'

import { createAuthenticatedFetch, type FetchLike } from '../auth/authenticated-fetch.ts'
import { createRecordingTelemetryProvider } from '../testing/recording-provider.ts'
import { createRequestTracer } from './request-span.ts'
import {
  at,
  ATTRIBUTION,
  mountOn,
  mountUntraced,
  resetPageWorkflows,
  setup,
  spanNamed,
} from './__tests__/harness.ts'

beforeEach(resetPageWorkflows)

const API = 'https://api.example.test'

function idsOf(span: SpanRecord): { traceId: string; spanId: string } {
  if (span.spanContext === undefined) throw new Error(`span ${span.name} has no ids`)
  return span.spanContext
}

function traceparentOf(span: SpanRecord): string {
  const { traceId, spanId } = idsOf(span)
  return `00-${traceId}-${spanId}-01`
}

/** A Widget from a bundle with no build hash, so it never collides with the App's. */
const PAYMENT: TelemetryAttribution = {
  definitionId: 'payment',
  definitionKind: 'widget',
  mountToken: 'payment#1',
}

/** The cart App from the harness and a payment Widget beside it, on one page and one provider. */
function page() {
  const cart = setup()
  const payment = mountOn(cart.provider, PAYMENT)
  return { provider: cart.provider, cart, payment }
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
      expect(span.events.map(event => event.name)).toEqual(['exception'])
      expect(span.endTime).toBeDefined()
    }
    expect(root.attributes['status']).toBe(503)

    const record = at(provider.logs('error'))
    expect(record.error).toBe(failure)
    expect(record.message).toBe('Order failed: 503')
    expect(record.attributes['status']).toBe(503)
    expect(record.spanContext).toEqual(idsOf(root))
  })

  it('joins the open run when started again, adding to it rather than abandoning it', () => {
    const { provider, telemetry } = setup()
    const checkout = telemetry.workflow('checkout')

    checkout.start({ items: 3 })
    checkout.step('shipping chosen')
    checkout.start({ coupon: true })

    const root = spanNamed(provider.spans, 'checkout')
    expect(provider.spansNamed('checkout')).toHaveLength(1)
    expect(provider.openSpans()).toHaveLength(2)
    expect(root.attributes).toMatchObject({ items: 3, coupon: true })
    expect(checkout.headers()).toEqual({
      traceparent: traceparentOf(spanNamed(provider.spans, 'shipping chosen')),
    })
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

  it('ends its open run as abandoned when the mount, alone in it, is disposed', () => {
    const { provider, diagnostics, telemetry } = setup()
    const checkout = telemetry.workflow('checkout')
    checkout.start()
    checkout.step('place order')

    telemetry.dispose()
    checkout.succeed()

    expect(provider.spans).toHaveLength(2)
    for (const span of provider.spans) {
      expect(span.attributes['mfe.span.end_reason']).toBe('abandoned')
      expect(span.status.code).toBe(SpanStatusCode.UNSET)
      expect(span.endTime).toBeDefined()
    }
    expect(checkout.headers()).toEqual({})
    expect(diagnostics.filter(d => d.error.code === 'dispose/failure')).toHaveLength(1)
  })

  it('opens a fresh run after a mount alone in it was disposed', () => {
    const first = setup()
    first.telemetry.workflow('checkout').start()
    first.telemetry.dispose()
    const second = mountOn(first.provider, PAYMENT)

    second.telemetry.workflow('checkout').start()

    const [abandoned, fresh] = first.provider.spansNamed('checkout')
    expect(abandoned?.endTime).toBeDefined()
    expect(fresh?.endTime).toBeUndefined()
    expect(fresh?.attribution.definitionId).toBe('payment')
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

describe('a workflow whose provider failed to build a tracer', () => {
  it('records no spans and sends no headers, but still reports a failure', () => {
    const provider = createRecordingTelemetryProvider()
    const { telemetry } = mountUntraced(provider)
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

  it('are emitted unlinked when the provider failed to build a tracer', () => {
    const provider = createRecordingTelemetryProvider()
    const { telemetry } = mountUntraced(provider)
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
  })

  it('are refused after the mount is disposed, like any record', () => {
    const { provider, diagnostics, telemetry } = setup()
    const checkout = telemetry.workflow('checkout')
    checkout.start()

    telemetry.dispose()
    checkout.info('quote received')
    checkout.event('checkout.quoted')
    checkout.measure('checkout.quote.latency', 120, { unit: 'ms' })
    checkout.error(new Error('late'))

    expect(provider.records).toHaveLength(0)
    expect(diagnostics.filter(d => d.error.code === 'dispose/failure')).toHaveLength(4)
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

describe('a workflow shared across the page', () => {
  it('is one run for every mount that starts it, whichever starts first', () => {
    const { provider, cart, payment } = page()

    payment.telemetry.workflow('orders.checkout').start({ method: 'card' })
    cart.telemetry.workflow('orders.checkout').start({ items: 3 })

    const root = spanNamed(provider.spans, 'orders.checkout')
    expect(provider.spansNamed('orders.checkout')).toHaveLength(1)
    expect(root.attribution.definitionId).toBe('payment')
    expect(root.attributes).toMatchObject({ method: 'card', items: 3 })
    expect(root.endTime).toBeUndefined()
    expect(cart.telemetry.workflow('orders.checkout').headers()).toEqual({
      traceparent: traceparentOf(root),
    })
  })

  it('ends one mount’s step with another’s, under the shared workflow', () => {
    const { provider, cart, payment } = page()
    cart.telemetry.workflow('orders.checkout').start()
    cart.telemetry.workflow('orders.checkout').step('review cart')

    payment.telemetry.workflow('orders.checkout').step('pay', { method: 'card' })

    const root = spanNamed(provider.spans, 'orders.checkout')
    const review = spanNamed(provider.spans, 'review cart')
    const pay = spanNamed(provider.spans, 'pay')
    expect(review.endTime).toBeDefined()
    expect(review.attributes['mfe.span.end_reason']).toBeUndefined()
    expect(pay.endTime).toBeUndefined()
    expect(pay.attribution.definitionId).toBe('payment')
    expect(pay.attributes['method']).toBe('card')
    expect(pay.parentSpanId).toBe(idsOf(root).spanId)
    expect(idsOf(pay).traceId).toBe(idsOf(root).traceId)
  })

  it('is acted on by a mount that never started it, which then takes part', () => {
    const { provider, cart, payment } = page()
    cart.telemetry.workflow('orders.checkout').start()
    payment.telemetry.workflow('orders.checkout').step('pay')

    cart.telemetry.dispose()
    payment.telemetry.workflow('orders.checkout').step('confirm')

    expect(spanNamed(provider.spans, 'orders.checkout').endTime).toBeUndefined()
    expect(spanNamed(provider.spans, 'confirm').endTime).toBeUndefined()
  })

  it('is ended for everyone by any mount in it', () => {
    const { provider, cart, payment } = page()
    const cartCheckout = cart.telemetry.workflow('orders.checkout')
    cartCheckout.start()
    cartCheckout.step('review cart')

    payment.telemetry.workflow('orders.checkout').succeed({ total: 42 })

    const root = spanNamed(provider.spans, 'orders.checkout')
    expect(provider.openSpans()).toHaveLength(0)
    expect(root.status.code).toBe(SpanStatusCode.OK)
    expect(root.attributes['total']).toBe(42)
    expect(cartCheckout.headers()).toEqual({})
    cartCheckout.step('too late')
    expect(
      cart.diagnostics.filter(d => d.error.message.includes('which was not open')),
    ).toHaveLength(1)
  })

  it('fails for everyone, reporting the error as the mount that failed it', () => {
    const { provider, cart, payment } = page()
    cart.telemetry.workflow('orders.checkout').start()
    cart.telemetry.workflow('orders.checkout').step('review cart')
    const declined = new Error('Card declined')

    payment.telemetry.workflow('orders.checkout').fail(declined)

    const root = spanNamed(provider.spans, 'orders.checkout')
    for (const span of [root, spanNamed(provider.spans, 'review cart')]) {
      expect(span.status.code).toBe(SpanStatusCode.ERROR)
      expect(span.events.map(event => event.name)).toEqual(['exception'])
    }
    const record = at(provider.logs('error'))
    expect(record.attribution.definitionId).toBe('payment')
    expect(record.spanContext).toEqual(idsOf(root))
  })

  it('opens a fresh run, in a new trace, when started after it ended', () => {
    const { provider, cart, payment } = page()
    cart.telemetry.workflow('orders.checkout').start()
    payment.telemetry.workflow('orders.checkout').succeed()

    payment.telemetry.workflow('orders.checkout').start()

    const [first, second] = provider.spansNamed('orders.checkout')
    expect(first?.endTime).toBeDefined()
    expect(second?.endTime).toBeUndefined()
    expect(second?.attribution.definitionId).toBe('payment')
    expect(second && idsOf(second).traceId).not.toBe(first && idsOf(first).traceId)
  })

  it('stays open when the mount that started it is disposed, without cancelling its spans', () => {
    const { provider, cart, payment } = page()
    cart.telemetry.workflow('orders.checkout').start()
    cart.telemetry.workflow('orders.checkout').step('review cart')
    payment.telemetry.workflow('orders.checkout').start()

    cart.telemetry.dispose()
    const root = spanNamed(provider.spans, 'orders.checkout')
    const review = spanNamed(provider.spans, 'review cart')
    const stillOpen = [root.endTime, review.endTime]
    payment.telemetry.workflow('orders.checkout').step('pay')
    payment.telemetry.workflow('orders.checkout').succeed()

    expect(stillOpen).toEqual([undefined, undefined])
    expect(provider.openSpans()).toHaveLength(0)
    expect(root.status.code).toBe(SpanStatusCode.OK)
    for (const span of [root, review]) {
      expect(span.attributes['mfe.span.end_reason']).toBeUndefined()
    }
    expect(cart.diagnostics).toHaveLength(0)
  })

  it('ends as abandoned once every mount in it is disposed', () => {
    const { provider, cart, payment } = page()
    cart.telemetry.workflow('orders.checkout').start()
    payment.telemetry.workflow('orders.checkout').step('pay')

    cart.telemetry.dispose()
    const openAfterFirst = provider.openSpans().length
    payment.telemetry.dispose()

    expect(openAfterFirst).toBe(2)
    for (const span of provider.spans) {
      expect(span.attributes['mfe.span.end_reason']).toBe('abandoned')
      expect(span.status.code).toBe(SpanStatusCode.UNSET)
      expect(span.endTime).toBeDefined()
    }
    expect(provider.logs('error')).toHaveLength(0)
    expect([...cart.diagnostics, ...payment.diagnostics]).toHaveLength(0)
  })

  it('is one run per key across the page', () => {
    const { provider, cart, payment } = page()

    cart.telemetry.workflow('upload', 'file-a').start()
    payment.telemetry.workflow('upload', 'file-a').start()
    payment.telemetry.workflow('upload', 'file-b').start()
    payment.telemetry.workflow('upload', 'file-a').succeed()

    const [a, b] = provider.spansNamed('upload')
    expect(provider.spansNamed('upload')).toHaveLength(2)
    expect(a?.attribution.definitionId).toBe('operations-console')
    expect(a?.status.code).toBe(SpanStatusCode.OK)
    expect(b?.endTime).toBeUndefined()
  })

  it('links records from any mount in it to the shared step, attributed to that mount', () => {
    const { provider, cart, payment } = page()
    cart.telemetry.workflow('orders.checkout').start()
    cart.telemetry.workflow('orders.checkout').step('review cart')

    payment.telemetry.workflow('orders.checkout').info('card form shown')

    const record = at(provider.logs('info'))
    expect(record.attribution.definitionId).toBe('payment')
    expect(record.spanContext).toEqual(idsOf(spanNamed(provider.spans, 'review cart')))
  })

  it('gives every mount the shared current step’s headers', () => {
    const { provider, cart, payment } = page()
    cart.telemetry.workflow('orders.checkout').start()
    cart.telemetry.workflow('orders.checkout').step('review cart')

    expect(payment.telemetry.workflow('orders.checkout').headers()).toEqual({
      traceparent: traceparentOf(spanNamed(provider.spans, 'review cart')),
    })
  })

  it('keeps a mount that only read its headers in it until that mount is disposed', () => {
    const { provider, cart, payment } = page()
    cart.telemetry.workflow('orders.checkout').start()
    payment.telemetry.workflow('orders.checkout').headers()

    cart.telemetry.dispose()

    expect(spanNamed(provider.spans, 'orders.checkout').endTime).toBeUndefined()
  })

  it('carries a request sent with another mount’s headers into the shared trace', async () => {
    const { provider, cart, payment } = page()
    const sent: Headers[] = []
    const fetch = createAuthenticatedFetch({
      apiBaseUrl: `${API}/v1/`,
      allowedOrigins: [API],
      tokens: { getAccessToken: async () => 'token-1' },
      fetch: async (_input, init) => {
        sent.push(new Headers(init?.headers))
        return new Response('{}', { status: 200 })
      },
      tracer: createRequestTracer(provider, { definitionId: 'payment', definitionKind: 'widget' }),
    })
    cart.telemetry.workflow('orders.checkout').start()
    const payCheckout = payment.telemetry.workflow('orders.checkout')
    payCheckout.step('pay')

    await fetch('payments', { method: 'POST', headers: payCheckout.headers() })

    const root = spanNamed(provider.spans, 'orders.checkout')
    const pay = spanNamed(provider.spans, 'pay')
    const request = spanNamed(provider.spans, 'POST')
    expect(idsOf(request).traceId).toBe(idsOf(root).traceId)
    expect(request.parentSpanId).toBe(idsOf(pay).spanId)
    expect(at(sent).get('traceparent')).toBe(traceparentOf(request))
  })

  it('is joined by a mount without a tracer, which marks steps without spans', () => {
    const cart = setup()
    const quiet = mountUntraced(cart.provider, PAYMENT)
    cart.telemetry.workflow('orders.checkout').start()
    cart.telemetry.workflow('orders.checkout').step('review cart')

    quiet.telemetry.workflow('orders.checkout').step('pay')
    const headers = quiet.telemetry.workflow('orders.checkout').headers()
    cart.telemetry.dispose()

    const root = spanNamed(cart.provider.spans, 'orders.checkout')
    expect(cart.provider.spans).toHaveLength(2)
    expect(spanNamed(cart.provider.spans, 'review cart').endTime).toBeDefined()
    expect(headers).toEqual({ traceparent: traceparentOf(root) })
    expect(root.endTime).toBeUndefined()
  })

  it('sends no headers when the mount that opened it had no tracer', () => {
    const provider = createRecordingTelemetryProvider()
    const quiet = mountUntraced(provider)
    const payment = mountOn(provider, PAYMENT)
    quiet.telemetry.workflow('orders.checkout').start()

    payment.telemetry.workflow('orders.checkout').step('pay')

    expect(payment.telemetry.workflow('orders.checkout').headers()).toEqual({})
    expect(provider.spans).toHaveLength(0)
  })
})

describe('an unprefixed workflow name shared by several definitions', () => {
  function definition(definitionId: string): TelemetryAttribution {
    return { definitionId, definitionKind: 'widget', mountToken: `${definitionId}#1` }
  }

  function collisions(diagnostics: readonly { error: { message: string } }[]): number {
    return diagnostics.filter(d => d.error.message.includes('under an unprefixed name')).length
  }

  it('is diagnosed once per run, naming both and suggesting a prefix', () => {
    const { provider, cart } = page()
    const reviews = mountOn(provider, definition('reviews'))
    const ratings = mountOn(provider, definition('ratings'))
    cart.telemetry.workflow('checkout').start()

    reviews.telemetry.workflow('checkout').start()
    ratings.telemetry.workflow('checkout').step('rate')
    const firstRun = collisions([...reviews.diagnostics, ...ratings.diagnostics])
    reviews.telemetry.workflow('checkout').succeed()
    reviews.telemetry.workflow('checkout').start()
    cart.telemetry.workflow('checkout').start()

    expect(firstRun).toBe(1)
    const message = at(reviews.diagnostics).error.message
    expect(message).toContain('operations-console and reviews')
    expect(message).toContain('"orders.checkout"')
    expect(collisions([...cart.diagnostics, ...reviews.diagnostics])).toBe(2)
  })

  it('is not diagnosed for a prefixed name or one definition', () => {
    const { provider, cart } = page()
    const reviews = mountOn(provider, definition('reviews'))
    const secondCart = mountOn(provider, ATTRIBUTION)

    cart.telemetry.workflow('orders.checkout').start()
    reviews.telemetry.workflow('orders.checkout').start()
    cart.telemetry.workflow('checkout').start()
    secondCart.telemetry.workflow('checkout').start()

    expect(
      collisions([...cart.diagnostics, ...reviews.diagnostics, ...secondCart.diagnostics]),
    ).toBe(0)
  })
})
