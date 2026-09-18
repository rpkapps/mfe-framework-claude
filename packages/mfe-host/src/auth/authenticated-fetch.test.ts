import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DiagnosticsHub, type Diagnostic } from '@company/mfe-core'

import {
  createAuthenticatedFetch,
  createAuthTransport,
  type AccessTokenSource,
  type FetchLike,
} from './authenticated-fetch.ts'
import { createSessionTokenService, type SessionFailure } from './session.ts'

const API = 'https://api.example.test'
const BASE = `${API}/v1/`
const REPORTS = 'https://reports.example.test'
const THIRD_PARTY = 'https://analytics.vendor.test'

interface FetchCall {
  readonly input: RequestInfo | URL
  readonly init: RequestInit | undefined
}

interface FakeFetch {
  readonly fetch: FetchLike
  readonly calls: readonly FetchCall[]
  readonly spy: ReturnType<typeof vi.fn>
}

/** Records every attempt and answers with whatever the handler decides. */
function fakeFetch(
  handler: (call: FetchCall, attempt: number) => Response | Promise<Response>,
): FakeFetch {
  const calls: FetchCall[] = []
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: FetchCall = { input, init }
    calls.push(call)
    return handler(call, calls.length)
  })
  return { fetch: spy as unknown as FetchLike, calls, spy }
}

function ok(): Response {
  return new Response('{}', { status: 200 })
}

function urlOf(call: FetchCall): string {
  if (call.input instanceof Request) return call.input.url
  return String(call.input)
}

function authOf(call: FetchCall): string | null {
  if (call.input instanceof Request) return call.input.headers.get('authorization')
  return new Headers(call.init?.headers).get('authorization')
}

function headerOf(call: FetchCall, name: string): string | null {
  if (call.input instanceof Request) return call.input.headers.get(name)
  return new Headers(call.init?.headers).get(name)
}

function methodOf(call: FetchCall): string {
  if (call.input instanceof Request) return call.input.method
  return String(call.init?.method ?? 'GET')
}

/** A token source that never refreshes; for the attachment-only cases. */
function staticTokens(token: string | null): AccessTokenSource & {
  readonly getAccessToken: ReturnType<typeof vi.fn>
} {
  const getAccessToken = vi.fn(async () => token)
  return { getAccessToken } as AccessTokenSource & {
    readonly getAccessToken: ReturnType<typeof vi.fn>
  }
}

function flush(): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, 0)
  })
}

let diagnostics: DiagnosticsHub
let reported: Diagnostic[]

beforeEach(() => {
  diagnostics = new DiagnosticsHub()
  reported = []
  diagnostics.add(diagnostic => reported.push(diagnostic))
})

describe('createAuthenticatedFetch: it wraps, it does not patch', () => {
  it('leaves globalThis.fetch exactly as it found it', async () => {
    const original = globalThis.fetch
    const inner = fakeFetch(() => ok())

    const authenticatedFetch = createAuthenticatedFetch({
      apiBaseUrl: BASE,
      allowedOrigins: [API],
      tokens: staticTokens('token-1'),
      fetch: inner.fetch,
    })
    await authenticatedFetch('assets')

    expect(globalThis.fetch).toBe(original)
    expect(inner.calls).toHaveLength(1)
  })

  it('delegates to globalThis.fetch by default without ever assigning to it', async () => {
    const original = globalThis.fetch
    const spy = vi.fn(async () => ok())
    globalThis.fetch = spy as unknown as typeof globalThis.fetch

    try {
      const authenticatedFetch = createAuthenticatedFetch({
        apiBaseUrl: BASE,
        allowedOrigins: [API],
        tokens: staticTokens('token-1'),
      })
      await authenticatedFetch('assets')

      expect(spy).toHaveBeenCalledTimes(1)
      // Still the test's own function: nothing wrapped or replaced the global.
      expect(globalThis.fetch).toBe(spy)
    } finally {
      globalThis.fetch = original
    }
  })
})

describe('createAuthenticatedFetch: URL resolution', () => {
  function withBase(base?: string): FakeFetch & { readonly call: FetchLike } {
    const inner = fakeFetch(() => ok())
    const authenticatedFetch = createAuthenticatedFetch({
      ...(base === undefined ? {} : { apiBaseUrl: base }),
      allowedOrigins: [API, REPORTS],
      tokens: staticTokens('token-1'),
      fetch: inner.fetch,
    })
    return { ...inner, call: authenticatedFetch }
  }

  it('resolves a bare relative path under the base path', async () => {
    const harness = withBase(BASE)
    await harness.call('assets')

    expect(urlOf(harness.calls[0]!)).toBe(`${API}/v1/assets`)
  })

  it('resolves a root-relative path at the origin root, not under the base path', async () => {
    const harness = withBase(BASE)
    await harness.call('/assets')

    expect(urlOf(harness.calls[0]!)).toBe(`${API}/assets`)
  })

  it('resolves against the API base rather than the shell document URL', async () => {
    // jsdom serves the shell document from localhost; a relative request must
    // never pick that up.
    expect(globalThis.location.origin).not.toBe(API)

    const harness = withBase(BASE)
    await harness.call('assets')

    expect(urlOf(harness.calls[0]!).startsWith(API)).toBe(true)
  })

  it('leaves an absolute URL to another declared API alone', async () => {
    const harness = withBase(BASE)
    await harness.call(`${REPORTS}/daily`)

    expect(urlOf(harness.calls[0]!)).toBe(`${REPORTS}/daily`)
  })

  it('accepts a URL object', async () => {
    const harness = withBase(BASE)
    await harness.call(new URL(`${API}/v1/assets?page=2`))

    expect(urlOf(harness.calls[0]!)).toBe(`${API}/v1/assets?page=2`)
  })

  it('keeps the URL a Request object already resolved', async () => {
    const harness = withBase(BASE)
    await harness.call(new Request(`${REPORTS}/daily`))

    expect(urlOf(harness.calls[0]!)).toBe(`${REPORTS}/daily`)
  })

  it('fails a relative request with no configured base before any network activity', async () => {
    const harness = withBase(undefined)

    await expect(harness.call('assets')).rejects.toMatchObject({
      code: 'config/missing',
      operation: 'resolve the request URL',
    })
    expect(harness.spy).not.toHaveBeenCalled()
  })

  it('explains the missing base in terms the developer can act on', async () => {
    const harness = withBase(undefined)
    let message = ''
    try {
      await harness.call('/assets')
    } catch (error) {
      message = (error as Error).message
    }

    expect(message).toContain('apiBaseUrl')
    expect(message).toContain('"/assets"')
    expect(message).toContain('shell document URL')
  })

  it('still serves absolute requests when no base is configured', async () => {
    const harness = withBase(undefined)
    await harness.call(`${API}/v1/assets`)

    expect(urlOf(harness.calls[0]!)).toBe(`${API}/v1/assets`)
  })

  it('rejects a malformed apiBaseUrl at wiring time rather than per request', () => {
    const create = (apiBaseUrl: string): FetchLike =>
      createAuthenticatedFetch({
        apiBaseUrl,
        allowedOrigins: [API],
        tokens: staticTokens('token-1'),
        fetch: fakeFetch(() => ok()).fetch,
      })

    expect(() => create('/api')).toThrow(/not an absolute URL/)
    expect(() => create('')).toThrow(/environment variable/)
    expect(() => create('ftp://api.example.test')).toThrow(/http\(s\)/)

    let thrown: unknown
    try {
      create('/api')
    } catch (error) {
      thrown = error
    }
    expect(thrown).toMatchObject({ code: 'config/invalid', operation: 'accept apiBaseUrl' })
  })
})

describe('createAuthenticatedFetch: token attachment', () => {
  it('attaches the bearer token to a declared API origin', async () => {
    const inner = fakeFetch(() => ok())
    const authenticatedFetch = createAuthenticatedFetch({
      apiBaseUrl: BASE,
      allowedOrigins: [API, REPORTS],
      tokens: staticTokens('token-1'),
      fetch: inner.fetch,
    })

    await authenticatedFetch('assets')
    await authenticatedFetch(`${REPORTS}/daily`)

    expect(authOf(inner.calls[0]!)).toBe('Bearer token-1')
    expect(authOf(inner.calls[1]!)).toBe('Bearer token-1')
  })

  it('attaches the token to a Request object bound for a declared origin', async () => {
    const inner = fakeFetch(() => ok())
    const authenticatedFetch = createAuthenticatedFetch({
      apiBaseUrl: BASE,
      allowedOrigins: [API],
      tokens: staticTokens('token-1'),
      fetch: inner.fetch,
    })

    await authenticatedFetch(new Request(`${API}/v1/assets`))

    expect(authOf(inner.calls[0]!)).toBe('Bearer token-1')
  })

  it('leaves a request to an undeclared origin completely untouched', async () => {
    const tokens = staticTokens('token-1')
    const inner = fakeFetch(() => ok())
    const authenticatedFetch = createAuthenticatedFetch({
      apiBaseUrl: BASE,
      allowedOrigins: [API],
      tokens,
      fetch: inner.fetch,
      diagnostics,
      isDevelopment: true,
    })

    await authenticatedFetch(`${THIRD_PARTY}/collect`)

    expect(inner.calls).toHaveLength(1)
    expect(authOf(inner.calls[0]!)).toBeNull()
    // The token is never even read for an origin that may not have it.
    expect(tokens.getAccessToken).not.toHaveBeenCalled()
  })

  it('warns in development that an undeclared origin is why the 401 looks like a token bug', async () => {
    const inner = fakeFetch(() => new Response('', { status: 401 }))
    const authenticatedFetch = createAuthenticatedFetch({
      apiBaseUrl: BASE,
      allowedOrigins: [API],
      tokens: staticTokens('token-1'),
      fetch: inner.fetch,
      diagnostics,
      isDevelopment: true,
    })

    await authenticatedFetch(`${THIRD_PARTY}/collect`)

    expect(reported).toHaveLength(1)
    const diagnostic = reported[0]!
    expect(diagnostic.severity).toBe('warning')
    expect(diagnostic.error.code).toBe('auth/undeclared-origin')
    expect(diagnostic.context).toMatchObject({ origin: THIRD_PARTY, method: 'GET' })
    expect(diagnostic.error.message).toContain(THIRD_PARTY)
    expect(diagnostic.error.message).toContain('{ api: true }')
    expect(diagnostic.error.message).toContain('answers 401')
    expect(diagnostic.error.message).toContain('not an expired or broken token')
  })

  it('warns once per origin so the console stays readable', async () => {
    const inner = fakeFetch(() => ok())
    const authenticatedFetch = createAuthenticatedFetch({
      apiBaseUrl: BASE,
      allowedOrigins: [API],
      tokens: staticTokens('token-1'),
      fetch: inner.fetch,
      diagnostics,
      isDevelopment: true,
    })

    await authenticatedFetch(`${THIRD_PARTY}/collect`)
    await authenticatedFetch(`${THIRD_PARTY}/collect?again=1`)
    await authenticatedFetch('https://other.vendor.test/x')

    expect(reported).toHaveLength(2)
  })

  it('stays silent about undeclared origins in production', async () => {
    const inner = fakeFetch(() => ok())
    const authenticatedFetch = createAuthenticatedFetch({
      apiBaseUrl: BASE,
      allowedOrigins: [API],
      tokens: staticTokens('token-1'),
      fetch: inner.fetch,
      diagnostics,
      isDevelopment: false,
    })

    await authenticatedFetch(`${THIRD_PARTY}/collect`)

    expect(reported).toHaveLength(0)
  })

  it('never writes a token value into a diagnostic', async () => {
    const inner = fakeFetch(() => ok())
    const authenticatedFetch = createAuthenticatedFetch({
      apiBaseUrl: BASE,
      allowedOrigins: [API],
      tokens: staticTokens('s3cr3t-access-token'),
      fetch: inner.fetch,
      diagnostics,
      isDevelopment: true,
    })

    await authenticatedFetch(`${THIRD_PARTY}/collect`)

    const serialized = JSON.stringify(
      reported.map(entry => ({ message: entry.error.message, context: entry.context })),
    )
    expect(serialized).not.toContain('s3cr3t-access-token')
  })

  it('sends unauthenticated when the session has no token to give', async () => {
    const inner = fakeFetch(() => ok())
    const authenticatedFetch = createAuthenticatedFetch({
      apiBaseUrl: BASE,
      allowedOrigins: [API],
      tokens: staticTokens(null),
      fetch: inner.fetch,
    })

    await authenticatedFetch('assets')

    expect(authOf(inner.calls[0]!)).toBeNull()
  })
})

describe('createAuthenticatedFetch: an explicit caller Authorization header', () => {
  it('is preserved, and disables both attachment and retry', async () => {
    const tokens = staticTokens('token-1')
    const inner = fakeFetch(() => new Response('', { status: 401 }))
    const authenticatedFetch = createAuthenticatedFetch({
      apiBaseUrl: BASE,
      allowedOrigins: [API],
      tokens,
      fetch: inner.fetch,
    })

    const response = await authenticatedFetch('assets', {
      headers: { Authorization: 'Bearer caller-owned' },
    })

    expect(response.status).toBe(401)
    expect(inner.calls).toHaveLength(1)
    expect(authOf(inner.calls[0]!)).toBe('Bearer caller-owned')
    expect(tokens.getAccessToken).not.toHaveBeenCalled()
  })

  it('is recognized on a Request object too', async () => {
    const tokens = staticTokens('token-1')
    const inner = fakeFetch(() => new Response('', { status: 401 }))
    const authenticatedFetch = createAuthenticatedFetch({
      apiBaseUrl: BASE,
      allowedOrigins: [API],
      tokens,
      fetch: inner.fetch,
    })

    await authenticatedFetch(
      new Request(`${API}/v1/assets`, { headers: { authorization: 'Basic abc' } }),
    )

    expect(inner.calls).toHaveLength(1)
    expect(authOf(inner.calls[0]!)).toBe('Basic abc')
    expect(tokens.getAccessToken).not.toHaveBeenCalled()
  })
})

describe('createAuthenticatedFetch: 401 retry', () => {
  function rotatingSession(initial: string) {
    const state = { current: initial as string | null }
    let issued = 0
    const refreshToken = vi.fn(async () => {
      issued += 1
      state.current = `token-${issued + 1}`
      return state.current
    })
    const tokens = createSessionTokenService({
      getToken: () => state.current,
      refreshToken,
    })
    return { tokens, refreshToken, state }
  }

  it('retries once after refreshing and reproduces method, body and headers', async () => {
    const { tokens, refreshToken } = rotatingSession('token-1')
    const inner = fakeFetch(call =>
      authOf(call) === 'Bearer token-1' ? new Response('', { status: 401 }) : ok(),
    )
    const authenticatedFetch = createAuthenticatedFetch({
      apiBaseUrl: BASE,
      allowedOrigins: [API],
      tokens,
      fetch: inner.fetch,
    })

    const response = await authenticatedFetch('orders', {
      method: 'POST',
      body: '{"sku":"A-1"}',
      headers: { 'content-type': 'application/json', 'x-trace': 'abc' },
    })

    expect(response.status).toBe(200)
    expect(inner.calls).toHaveLength(2)
    expect(refreshToken).toHaveBeenCalledTimes(1)

    for (const call of inner.calls) {
      expect(methodOf(call)).toBe('POST')
      expect(call.init?.body).toBe('{"sku":"A-1"}')
      expect(headerOf(call, 'content-type')).toBe('application/json')
      expect(headerOf(call, 'x-trace')).toBe('abc')
      expect(urlOf(call)).toBe(`${API}/v1/orders`)
    }
    expect(authOf(inner.calls[0]!)).toBe('Bearer token-1')
    expect(authOf(inner.calls[1]!)).toBe('Bearer token-2')
  })

  it('preserves other request options such as credentials and cache on the retry', async () => {
    const { tokens } = rotatingSession('token-1')
    const inner = fakeFetch(call =>
      authOf(call) === 'Bearer token-1' ? new Response('', { status: 401 }) : ok(),
    )
    const authenticatedFetch = createAuthenticatedFetch({
      apiBaseUrl: BASE,
      allowedOrigins: [API],
      tokens,
      fetch: inner.fetch,
    })

    await authenticatedFetch('orders', { method: 'PUT', credentials: 'include', cache: 'no-store' })

    expect(inner.calls).toHaveLength(2)
    expect(inner.calls[1]?.init?.credentials).toBe('include')
    expect(inner.calls[1]?.init?.cache).toBe('no-store')
  })

  it('returns the second 401 instead of looping', async () => {
    const { tokens, refreshToken } = rotatingSession('token-1')
    const inner = fakeFetch(() => new Response('', { status: 401 }))
    const authenticatedFetch = createAuthenticatedFetch({
      apiBaseUrl: BASE,
      allowedOrigins: [API],
      tokens,
      fetch: inner.fetch,
    })

    const response = await authenticatedFetch('assets')

    expect(response.status).toBe(401)
    expect(inner.calls).toHaveLength(2)
    expect(refreshToken).toHaveBeenCalledTimes(1)
  })

  it('does not treat a 403 as an authentication problem', async () => {
    const { tokens, refreshToken } = rotatingSession('token-1')
    const inner = fakeFetch(() => new Response('', { status: 403 }))
    const authenticatedFetch = createAuthenticatedFetch({
      apiBaseUrl: BASE,
      allowedOrigins: [API],
      tokens,
      fetch: inner.fetch,
    })

    const response = await authenticatedFetch('admin')

    expect(response.status).toBe(403)
    expect(inner.calls).toHaveLength(1)
    expect(refreshToken).not.toHaveBeenCalled()
  })

  it('refreshes exactly once for a burst of concurrent 401s', async () => {
    const { tokens, refreshToken } = rotatingSession('token-1')
    const inner = fakeFetch(call =>
      authOf(call) === 'Bearer token-1' ? new Response('', { status: 401 }) : ok(),
    )
    const authenticatedFetch = createAuthenticatedFetch({
      apiBaseUrl: BASE,
      allowedOrigins: [API],
      tokens,
      fetch: inner.fetch,
    })

    const responses = await Promise.all([
      authenticatedFetch('a'),
      authenticatedFetch('b'),
      authenticatedFetch('c'),
      authenticatedFetch('d'),
      authenticatedFetch('e'),
    ])

    expect(responses.map(response => response.status)).toEqual([200, 200, 200, 200, 200])
    expect(refreshToken).toHaveBeenCalledTimes(1)
    expect(inner.calls).toHaveLength(10)
  })
})

describe('createAuthenticatedFetch: requests that cannot be replayed', () => {
  function streamingBody(): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('chunk'))
        controller.close()
      },
    })
  }

  function rotatingSession() {
    const refreshToken = vi.fn(async () => 'token-2')
    const tokens = createSessionTokenService({ getToken: () => 'token-1', refreshToken })
    return { tokens, refreshToken }
  }

  it('does not retry a ReadableStream body and explains why', async () => {
    const { tokens, refreshToken } = rotatingSession()
    const inner = fakeFetch(() => new Response('', { status: 401 }))
    const authenticatedFetch = createAuthenticatedFetch({
      apiBaseUrl: BASE,
      allowedOrigins: [API],
      tokens,
      fetch: inner.fetch,
      diagnostics,
    })

    const response = await authenticatedFetch('upload', {
      method: 'POST',
      body: streamingBody(),
      duplex: 'half',
    } as RequestInit)

    expect(response.status).toBe(401)
    expect(inner.calls).toHaveLength(1)

    expect(reported).toHaveLength(1)
    const diagnostic = reported[0]!
    expect(diagnostic.severity).toBe('warning')
    expect(diagnostic.error.message).toContain('ReadableStream')
    expect(diagnostic.error.message).toContain('cannot be read a second time')
    expect(diagnostic.error.message).toContain('getAccessToken')
    expect(diagnostic.context).toMatchObject({ origin: API, method: 'POST' })

    // The session is still renewed, so the next request is not doomed too.
    expect(refreshToken).toHaveBeenCalledTimes(1)
  })

  it('does not retry a Request object carrying a body', async () => {
    const { tokens } = rotatingSession()
    const inner = fakeFetch(() => new Response('', { status: 401 }))
    const authenticatedFetch = createAuthenticatedFetch({
      apiBaseUrl: BASE,
      allowedOrigins: [API],
      tokens,
      fetch: inner.fetch,
      diagnostics,
    })

    const response = await authenticatedFetch(
      new Request(`${API}/v1/orders`, { method: 'POST', body: 'payload' }),
    )

    expect(response.status).toBe(401)
    expect(inner.calls).toHaveLength(1)
    expect(reported[0]?.error.message).toContain('consumed by the attempt that sends it')
  })

  it('still retries a body-less Request object', async () => {
    const { tokens } = rotatingSession()
    const inner = fakeFetch(call =>
      authOf(call) === 'Bearer token-1' ? new Response('', { status: 401 }) : ok(),
    )
    const authenticatedFetch = createAuthenticatedFetch({
      apiBaseUrl: BASE,
      allowedOrigins: [API],
      tokens,
      fetch: inner.fetch,
      diagnostics,
    })

    const response = await authenticatedFetch(new Request(`${API}/v1/assets`))

    expect(response.status).toBe(200)
    expect(inner.calls).toHaveLength(2)
    expect(authOf(inner.calls[1]!)).toBe('Bearer token-2')
    expect(reported).toHaveLength(0)
  })
})

describe('createAuthenticatedFetch: session failure and cancellation', () => {
  it('surfaces a failed refresh as a session event, not as an error on the first mount', async () => {
    const failures: SessionFailure[] = []
    const refreshToken = vi.fn(async () => {
      throw new Error('refresh endpoint down')
    })
    const tokens = createSessionTokenService({
      getToken: () => 'token-1',
      refreshToken,
      onSessionFailure: failure => failures.push(failure),
    })
    const inner = fakeFetch(() => new Response('', { status: 401 }))
    const authenticatedFetch = createAuthenticatedFetch({
      apiBaseUrl: BASE,
      allowedOrigins: [API],
      tokens,
      fetch: inner.fetch,
    })

    // Whichever mount fires first gets an ordinary 401 Response to handle in its
    // data layer; it does not get a framework error to fail its mount with.
    const first = await authenticatedFetch('assets')
    const second = await authenticatedFetch('orders')

    expect(first.status).toBe(401)
    expect(second.status).toBe(401)
    expect(failures).toHaveLength(1)
    expect(failures[0]?.reason).toBe('refresh-failed')
    expect(refreshToken).toHaveBeenCalledTimes(1)
  })

  it('does not cancel the shared refresh when one request is abandoned', async () => {
    let releaseRefresh: (token: string) => void = () => {}
    const refreshSignals: AbortSignal[] = []
    const refreshToken = vi.fn((context: { signal: AbortSignal }) => {
      refreshSignals.push(context.signal)
      return new Promise<string>(resolve => {
        releaseRefresh = resolve
      })
    })
    const tokens = createSessionTokenService({ getToken: () => 'token-1', refreshToken })

    const inner = fakeFetch(call =>
      authOf(call) === 'Bearer token-1' ? new Response('', { status: 401 }) : ok(),
    )
    const authenticatedFetch = createAuthenticatedFetch({
      apiBaseUrl: BASE,
      allowedOrigins: [API],
      tokens,
      fetch: inner.fetch,
    })

    const leaving = new AbortController()
    const abandoned = authenticatedFetch('assets', { signal: leaving.signal })
    const staying = authenticatedFetch('orders')

    // Let both first attempts 401 and both callers reach the shared refresh.
    await flush()
    expect(refreshToken).toHaveBeenCalledTimes(1)

    leaving.abort()
    await expect(abandoned).rejects.toMatchObject({ name: 'AbortError' })

    releaseRefresh('token-2')
    const response = await staying
    expect(response.status).toBe(200)

    expect(refreshToken).toHaveBeenCalledTimes(1)
    expect(refreshSignals[0]?.aborted).toBe(false)
  })

  it('passes the caller signal through to the wrapped fetch', async () => {
    const inner = fakeFetch(() => ok())
    const authenticatedFetch = createAuthenticatedFetch({
      apiBaseUrl: BASE,
      allowedOrigins: [API],
      tokens: staticTokens('token-1'),
      fetch: inner.fetch,
    })
    const controller = new AbortController()

    await authenticatedFetch('assets', { signal: controller.signal })

    expect(inner.calls[0]?.init?.signal).toBe(controller.signal)
  })
})

describe('createAuthTransport', () => {
  it('serves both tiers from one single-flight session', async () => {
    const refreshToken = vi.fn(async () => 'token-2')
    const tokens = createSessionTokenService({ getToken: () => null, refreshToken })
    const inner = fakeFetch(() => ok())

    const transport = createAuthTransport({
      apiBaseUrl: BASE,
      allowedOrigins: [API],
      tokens,
      fetch: inner.fetch,
    })

    // A WebSocket connection and an HTTP request racing on a cold session.
    const [socketToken, response] = await Promise.all([
      transport.getAccessToken(),
      transport.fetch('assets'),
    ])

    expect(socketToken).toBe('token-2')
    expect(response.status).toBe(200)
    expect(authOf(inner.calls[0]!)).toBe('Bearer token-2')
    expect(refreshToken).toHaveBeenCalledTimes(1)
  })
})
