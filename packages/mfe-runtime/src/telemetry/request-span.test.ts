/**
 * Every request through a container's `#mfe/fetch` to a declared API is a client span, sent as the
 * backend's parent in `traceparent`: the root of a trace of its own, or a child of the workflow step
 * whose `headers()` the caller spread into it.
 */

import { afterEach, describe, expect, it } from 'vitest'

import {
  SpanKind,
  SpanStatusCode,
  type Span,
  type SpanRecord,
  type TelemetryProvider,
} from '@company/mfe-core'

import type { FetchLike } from '../auth/authenticated-fetch.ts'
import {
  createContainerTransport,
  installShellAuth,
  type ContainerAuthBinding,
} from '../auth/container-transport.ts'
import {
  createRecordingTelemetryProvider,
  type RecordingTelemetryProvider,
} from '../testing/recording-provider.ts'
import { at, setup, spanNamed } from './__tests__/harness.ts'

const API = 'https://api.example.test'
const CALLER = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'

const BINDING: ContainerAuthBinding = {
  id: 'operations',
  kind: 'app',
  apiBaseUrl: `${API}/v1/`,
  apiOrigins: [API],
}

let uninstall: (() => void) | null = null

afterEach(() => {
  uninstall?.()
  uninstall = null
})

function broken(): never {
  throw new Error('provider failure')
}

function idsOf(span: SpanRecord): { traceId: string; spanId: string } {
  if (span.spanContext === undefined) throw new Error(`span ${span.name} has no ids`)
  return span.spanContext
}

function traceparentOf(span: SpanRecord): string {
  const { traceId, spanId } = idsOf(span)
  return `00-${traceId}-${spanId}-01`
}

/**
 * A container's fetch on an installed session, answering every attempt with `respond`; each token
 * differs, so a 401 is retried with the refreshed one.
 */
function api(
  options: {
    readonly telemetry?: TelemetryProvider | undefined
    readonly respond?: (attempt: number) => Response | Promise<Response>
  } = {},
) {
  const sent: Headers[] = []
  const respond = options.respond ?? (() => new Response('{}', { status: 200 }))
  const fetch: FetchLike = async (_input, init) => {
    sent.push(new Headers(init?.headers))
    return await respond(sent.length)
  }
  let token = 0
  uninstall = installShellAuth({
    tokens: { getAccessToken: async () => `token-${String((token += 1))}` },
    fetch,
    ...(options.telemetry === undefined ? {} : { telemetry: options.telemetry }),
  })
  return { fetch: createContainerTransport(BINDING).fetch, sent }
}

function traced(
  respond?: (attempt: number) => Response | Promise<Response>,
): ReturnType<typeof api> & { provider: RecordingTelemetryProvider } {
  const provider = createRecordingTelemetryProvider()
  return {
    provider,
    ...api({ telemetry: provider, ...(respond === undefined ? {} : { respond }) }),
  }
}

describe('a request to a declared API', () => {
  it('is the root of a trace, with a client span the traceparent names', async () => {
    const { provider, fetch, sent } = traced()

    const response = await fetch('orders', { method: 'post' })

    const request = spanNamed(provider.spans, 'POST')
    expect(response.status).toBe(200)
    expect(at(sent).get('traceparent')).toBe(traceparentOf(request))
    expect(request.parentSpanId).toBeUndefined()
    expect(request.kind).toBe(SpanKind.CLIENT)
    expect(request.endTime).toBeDefined()
    expect(request.status.code).toBe(SpanStatusCode.UNSET)
    expect(request.attribution).toEqual({ definitionId: 'operations', definitionKind: 'app' })
    expect(request.attributes).toMatchObject({
      'http.request.method': 'POST',
      'server.address': 'api.example.test',
      'server.port': 443,
      'http.response.status_code': 200,
    })
  })

  it('joins the workflow step whose headers it carries, and names itself as the parent', async () => {
    const { provider, fetch, sent } = traced()
    const mount = setup()
    const checkout = mount.telemetry.workflow('checkout')
    checkout.start()
    checkout.step('place order')
    const step = idsOf(spanNamed(mount.provider.spans, 'place order'))

    await fetch('orders', { method: 'POST', headers: checkout.headers() })
    checkout.succeed()

    const request = spanNamed(provider.spans, 'POST')
    expect(idsOf(request).traceId).toBe(step.traceId)
    expect(request.parentSpanId).toBe(step.spanId)
    expect(at(sent).get('traceparent')).toBe(traceparentOf(request))
    expect(at(sent).get('authorization')).toBe('Bearer token-1')
  })

  it('never records the path or the query, which can carry ids', async () => {
    const { provider, fetch } = traced()

    await fetch('customers/c-1234?email=someone%40example.test')

    const values = Object.values(spanNamed(provider.spans, 'GET').attributes).map(String)
    expect(values.some(value => value.includes('c-1234') || value.includes('email'))).toBe(false)
  })

  it('keeps one client span and one traceparent across the retry after a 401', async () => {
    const { provider, fetch, sent } = traced(attempt =>
      attempt === 1 ? new Response('', { status: 401 }) : new Response('{}', { status: 200 }),
    )

    const response = await fetch('orders')

    expect(response.status).toBe(200)
    expect(sent).toHaveLength(2)
    expect(at(sent, 1).get('traceparent')).toBe(at(sent).get('traceparent'))
    expect(at(sent, 1).get('authorization')).toBe('Bearer token-2')
    expect(provider.spansNamed('GET')).toHaveLength(1)
    expect(spanNamed(provider.spans, 'GET').attributes).toMatchObject({
      'http.request.resend_count': 1,
      'http.response.status_code': 200,
    })
  })

  it.each([404, 503])('marks the client span as an error for a %i answer', async status => {
    const { provider, fetch } = traced(() => new Response('', { status }))

    const response = await fetch('orders')

    expect(response.status).toBe(status)
    const request = spanNamed(provider.spans, 'GET')
    expect(request.status.code).toBe(SpanStatusCode.ERROR)
    expect(request.attributes['http.response.status_code']).toBe(status)
    expect(request.endTime).toBeDefined()
  })

  it('records a network failure on the client span and still rejects', async () => {
    const failure = new TypeError('Failed to fetch')
    const { provider, fetch } = traced(() => Promise.reject(failure))

    await expect(fetch('orders')).rejects.toBe(failure)

    const request = spanNamed(provider.spans, 'GET')
    expect(request.status.code).toBe(SpanStatusCode.ERROR)
    expect(request.exceptions).toEqual([failure])
    expect(request.endTime).toBeDefined()
  })
})

describe('a request the framework leaves untraced', () => {
  it('sends no trace context to an origin that is not a declared API', async () => {
    const { provider, fetch, sent } = traced()

    await fetch('https://analytics.vendor.test/collect')
    await fetch('https://analytics.vendor.test/collect', { headers: { traceparent: CALLER } })

    expect(at(sent).has('traceparent')).toBe(false)
    expect(at(sent, 1).get('traceparent')).toBe(CALLER)
    expect(provider.spans).toHaveLength(0)
  })

  it('leaves a traceparent that is not W3C as the caller wrote it', async () => {
    const { provider, fetch, sent } = traced()
    const invalid = [
      'not-a-traceparent',
      '00-00000000000000000000000000000000-b7ad6b7169203331-01',
      'ff-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
    ]

    for (const traceparent of invalid) await fetch('orders', { headers: { traceparent } })

    expect(sent.map(headers => headers.get('traceparent'))).toEqual(invalid)
    expect(provider.spans).toHaveLength(0)
  })

  it('goes out exactly as before when the shell installed no telemetry', async () => {
    const { fetch, sent } = api()

    await fetch('orders')
    await fetch('orders', { headers: { traceparent: CALLER } })

    expect(at(sent).has('traceparent')).toBe(false)
    expect(at(sent, 1).get('traceparent')).toBe(CALLER)
  })

  it('still succeeds when the provider cannot build a tracer', async () => {
    const provider = createRecordingTelemetryProvider()
    provider.failTracerCreation(true)
    const { fetch, sent } = api({ telemetry: provider })

    const response = await fetch('orders')

    expect(response.status).toBe(200)
    expect(at(sent).has('traceparent')).toBe(false)
  })

  it('still succeeds, as the caller wrote it, when the provider cannot start a span', async () => {
    const { fetch, sent } = api({
      telemetry: { record: broken, createTracer: () => ({ startSpan: broken }) },
    })

    const response = await fetch('orders', { headers: { traceparent: CALLER } })

    expect(response.status).toBe(200)
    expect(at(sent).get('traceparent')).toBe(CALLER)
  })

  it("still succeeds when the provider's span throws on every call", async () => {
    const span = new Proxy({}, { get: () => broken }) as Span
    const { fetch, sent } = api({
      telemetry: { record: broken, createTracer: () => ({ startSpan: () => span }) },
    })

    const response = await fetch('orders', { method: 'POST' })

    expect(response.status).toBe(200)
    expect(at(sent).get('traceparent')).toMatch(/^00-[\da-f]{32}-[\da-f]{16}-01$/)
  })
})
