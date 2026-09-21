import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DiagnosticsHub, type Diagnostic } from '@company/mfe-core'

import {
  createAuthenticatedFetch,
  createAuthTransport,
  type AccessTokenSource,
  type AuthenticatedFetchOptions,
  type FetchLike,
} from './authenticated-fetch.ts'
import { createSessionTokenService } from './session.ts'
import { at, flush } from '../__tests__/harness.ts'

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
    return await handler(call, calls.length)
  })
  return { fetch: spy, calls, spy }
}

function ok(): Response {
  return new Response('{}', { status: 200 })
}

function unauthorized(): Response {
  return new Response('', { status: 401 })
}

/** 401 for the first token the session issued, 200 for anything newer. */
function staleTokenRejected(call: FetchCall): Response {
  return authOf(call) === 'Bearer token-1' ? unauthorized() : ok()
}

function urlOf(call: FetchCall): string {
  return call.input instanceof Request ? call.input.url : String(call.input)
}

function headerOf(call: FetchCall, name: string): string | null {
  const headers =
    call.input instanceof Request ? call.input.headers : new Headers(call.init?.headers)
  return headers.get(name)
}

function authOf(call: FetchCall): string | null {
  return headerOf(call, 'authorization')
}

function methodOf(call: FetchCall): string {
  return call.input instanceof Request ? call.input.method : String(call.init?.method ?? 'GET')
}

/** A token source that never refreshes; for the attachment-only cases. */
function staticTokens(token: string | null): AccessTokenSource & {
  readonly getAccessToken: ReturnType<typeof vi.fn>
} {
  const getAccessToken = vi.fn(async () => token)
  return { getAccessToken }
}

type HarnessOptions = Omit<Partial<AuthenticatedFetchOptions>, 'apiBaseUrl' | 'fetch'> & {
  /** `null` configures no base at all; omitted means the standard API base. */
  readonly apiBaseUrl?: string | null
}

interface Harness extends FakeFetch {
  readonly call: FetchLike
}

/** One wrapped fetch over one recording inner fetch, with the usual wiring. */
function harness(
  options: HarnessOptions = {},
  handler: (call: FetchCall, attempt: number) => Response | Promise<Response> = ok,
): Harness {
  const { apiBaseUrl, ...rest } = options
  const inner = fakeFetch(handler)
  const call = createAuthenticatedFetch({
    ...(apiBaseUrl === null ? {} : { apiBaseUrl: apiBaseUrl ?? BASE }),
    allowedOrigins: [API, REPORTS],
    tokens: staticTokens('token-1'),
    fetch: inner.fetch,
    ...rest,
  })
  return { ...inner, call }
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
    const api = harness()

    await api.call('assets')

    expect(globalThis.fetch).toBe(original)
    expect(api.calls).toHaveLength(1)
  })

  it('delegates to globalThis.fetch by default without ever assigning to it', async () => {
    const original = globalThis.fetch
    const spy = vi.fn(async () => ok())
    globalThis.fetch = spy

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
  it.each([
    ['a bare relative path, under the base path', 'assets', `${API}/v1/assets`],
    ['a root-relative path, at the origin root', '/assets', `${API}/assets`],
    ['an absolute URL to another declared API', `${REPORTS}/daily`, `${REPORTS}/daily`],
  ])('resolves %s', async (_label, input, expected) => {
    const api = harness()
    await api.call(input)

    expect(urlOf(at(api.calls))).toBe(expected)
  })

  it('resolves against the API base rather than the shell document URL', async () => {
    // jsdom serves the shell document from localhost; a relative request must never pick
    // that up.
    expect(globalThis.location.origin).not.toBe(API)

    const api = harness()
    await api.call('assets')

    expect(urlOf(at(api.calls)).startsWith(API)).toBe(true)
  })

  it('accepts a URL object', async () => {
    const api = harness()
    await api.call(new URL(`${API}/v1/assets?page=2`))

    expect(urlOf(at(api.calls))).toBe(`${API}/v1/assets?page=2`)
  })

  it('keeps the URL a Request object already resolved', async () => {
    const api = harness()
    await api.call(new Request(`${REPORTS}/daily`))

    expect(urlOf(at(api.calls))).toBe(`${REPORTS}/daily`)
  })

  it('fails a relative request with no configured base before any network activity', async () => {
    const api = harness({ apiBaseUrl: null })

    await expect(api.call('assets')).rejects.toMatchObject({
      code: 'config/missing',
      operation: 'resolve the request URL',
    })
    expect(api.spy).not.toHaveBeenCalled()
  })

  it('explains the missing base in terms the developer can act on', async () => {
    const api = harness({ apiBaseUrl: null })
    let message = ''
    try {
      await api.call('/assets')
    } catch (error) {
      message = (error as Error).message
    }

    expect(message).toContain('apiBaseUrl')
    expect(message).toContain('"/assets"')
    expect(message).toContain('shell document URL')
  })

  it('still serves absolute requests when no base is configured', async () => {
    const api = harness({ apiBaseUrl: null })
    await api.call(`${API}/v1/assets`)

    expect(urlOf(at(api.calls))).toBe(`${API}/v1/assets`)
  })

  it('rejects a malformed apiBaseUrl at wiring time rather than per request', () => {
    const create = (apiBaseUrl: string): Harness => harness({ apiBaseUrl })

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
    const api = harness()

    await api.call('assets')
    await api.call(`${REPORTS}/daily`)

    expect(authOf(at(api.calls))).toBe('Bearer token-1')
    expect(authOf(at(api.calls, 1))).toBe('Bearer token-1')
  })

  it('attaches the token to a Request object bound for a declared origin', async () => {
    const api = harness()

    await api.call(new Request(`${API}/v1/assets`))

    expect(authOf(at(api.calls))).toBe('Bearer token-1')
  })

  it('leaves a request to an undeclared origin completely untouched', async () => {
    const tokens = staticTokens('token-1')
    const api = harness({ tokens, diagnostics, isDevelopment: true })

    await api.call(`${THIRD_PARTY}/collect`)

    expect(api.calls).toHaveLength(1)
    expect(authOf(at(api.calls))).toBeNull()
    expect(tokens.getAccessToken).not.toHaveBeenCalled()
  })

  it('warns in development that an undeclared origin is why the 401 looks like a token bug', async () => {
    const api = harness({ diagnostics, isDevelopment: true }, unauthorized)

    await api.call(`${THIRD_PARTY}/collect`)

    expect(reported).toHaveLength(1)
    const diagnostic = at(reported)
    expect(diagnostic.severity).toBe('warning')
    expect(diagnostic.error.code).toBe('auth/undeclared-origin')
    expect(diagnostic.context).toMatchObject({ origin: THIRD_PARTY, method: 'GET' })
    expect(diagnostic.error.message).toContain(THIRD_PARTY)
    expect(diagnostic.error.message).toContain('{ api: true }')
    expect(diagnostic.error.message).toContain('answers 401')
    expect(diagnostic.error.message).toContain('not a broken token')
  })

  it('warns once per origin so the console stays readable', async () => {
    const api = harness({ diagnostics, isDevelopment: true })

    await api.call(`${THIRD_PARTY}/collect`)
    await api.call(`${THIRD_PARTY}/collect?again=1`)
    await api.call('https://other.vendor.test/x')

    expect(reported).toHaveLength(2)
  })

  it('stays silent about undeclared origins in production', async () => {
    const api = harness({ diagnostics, isDevelopment: false })

    await api.call(`${THIRD_PARTY}/collect`)

    expect(reported).toHaveLength(0)
  })

  it('never writes a token value into a diagnostic', async () => {
    const api = harness({
      tokens: staticTokens('s3cr3t-access-token'),
      diagnostics,
      isDevelopment: true,
    })

    await api.call(`${THIRD_PARTY}/collect`)

    const serialized = JSON.stringify(
      reported.map(entry => ({ message: entry.error.message, context: entry.context })),
    )
    expect(serialized).not.toContain('s3cr3t-access-token')
  })

  it('sends unauthenticated when the session has no token to give', async () => {
    const api = harness({ tokens: staticTokens(null) })

    await api.call('assets')

    expect(authOf(at(api.calls))).toBeNull()
  })
})

describe('createAuthenticatedFetch: an explicit caller Authorization header', () => {
  it('is preserved, and disables both attachment and retry', async () => {
    const tokens = staticTokens('token-1')
    const api = harness({ tokens }, unauthorized)

    const response = await api.call('assets', {
      headers: { Authorization: 'Bearer caller-owned' },
    })

    expect(response.status).toBe(401)
    expect(api.calls).toHaveLength(1)
    expect(authOf(at(api.calls))).toBe('Bearer caller-owned')
    expect(tokens.getAccessToken).not.toHaveBeenCalled()
  })

  it('is recognized on a Request object too', async () => {
    const tokens = staticTokens('token-1')
    const api = harness({ tokens }, unauthorized)

    await api.call(new Request(`${API}/v1/assets`, { headers: { authorization: 'Basic abc' } }))

    expect(api.calls).toHaveLength(1)
    expect(authOf(at(api.calls))).toBe('Basic abc')
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
    const api = harness({ tokens }, staleTokenRejected)

    const response = await api.call('orders', {
      method: 'POST',
      body: '{"sku":"A-1"}',
      headers: { 'content-type': 'application/json', 'x-trace': 'abc' },
    })

    expect(response.status).toBe(200)
    expect(api.calls).toHaveLength(2)
    expect(refreshToken).toHaveBeenCalledTimes(1)

    for (const call of api.calls) {
      expect(methodOf(call)).toBe('POST')
      expect(call.init?.body).toBe('{"sku":"A-1"}')
      expect(headerOf(call, 'content-type')).toBe('application/json')
      expect(headerOf(call, 'x-trace')).toBe('abc')
      expect(urlOf(call)).toBe(`${API}/v1/orders`)
    }
    expect(authOf(at(api.calls))).toBe('Bearer token-1')
    expect(authOf(at(api.calls, 1))).toBe('Bearer token-2')
  })

  it('preserves other request options such as credentials and cache on the retry', async () => {
    const { tokens } = rotatingSession('token-1')
    const api = harness({ tokens }, staleTokenRejected)

    await api.call('orders', { method: 'PUT', credentials: 'include', cache: 'no-store' })

    expect(api.calls).toHaveLength(2)
    expect(at(api.calls, 1).init?.credentials).toBe('include')
    expect(at(api.calls, 1).init?.cache).toBe('no-store')
  })

  it('returns the second 401 instead of looping', async () => {
    const { tokens, refreshToken } = rotatingSession('token-1')
    const api = harness({ tokens }, unauthorized)

    const response = await api.call('assets')

    expect(response.status).toBe(401)
    expect(api.calls).toHaveLength(2)
    expect(refreshToken).toHaveBeenCalledTimes(1)
  })

  it('does not treat a 403 as an authentication problem', async () => {
    const { tokens, refreshToken } = rotatingSession('token-1')
    const api = harness({ tokens }, () => new Response('', { status: 403 }))

    const response = await api.call('admin')

    expect(response.status).toBe(403)
    expect(api.calls).toHaveLength(1)
    expect(refreshToken).not.toHaveBeenCalled()
  })

  it('refreshes exactly once for a burst of concurrent 401s', async () => {
    const { tokens, refreshToken } = rotatingSession('token-1')
    const api = harness({ tokens }, staleTokenRejected)

    const responses = await Promise.all(['a', 'b', 'c', 'd', 'e'].map(path => api.call(path)))

    expect(responses.map(response => response.status)).toEqual([200, 200, 200, 200, 200])
    expect(refreshToken).toHaveBeenCalledTimes(1)
    expect(api.calls).toHaveLength(10)
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
    const api = harness({ tokens, diagnostics }, unauthorized)

    // `duplex` is mandatory on the platform whenever the body is a stream, and is not part
    // of `RequestInit` in this TypeScript release yet.
    const init: RequestInit & { readonly duplex: 'half' } = {
      method: 'POST',
      body: streamingBody(),
      duplex: 'half',
    }
    const response = await api.call('upload', init)

    expect(response.status).toBe(401)
    expect(api.calls).toHaveLength(1)

    expect(reported).toHaveLength(1)
    const diagnostic = at(reported)
    expect(diagnostic.severity).toBe('warning')
    expect(diagnostic.error.message).toContain('ReadableStream')
    expect(diagnostic.error.message).toContain('cannot be read a second time')
    expect(diagnostic.error.message).toContain('handle the 401 at the call site')
    expect(diagnostic.context).toMatchObject({ origin: API, method: 'POST' })

    // The session is still renewed, so the next request is not doomed too.
    expect(refreshToken).toHaveBeenCalledTimes(1)
  })

  it('does not retry a Request object carrying a body', async () => {
    const { tokens } = rotatingSession()
    const api = harness({ tokens, diagnostics }, unauthorized)

    const response = await api.call(
      new Request(`${API}/v1/orders`, { method: 'POST', body: 'payload' }),
    )

    expect(response.status).toBe(401)
    expect(api.calls).toHaveLength(1)
    expect(at(reported).error.message).toContain('consumed by the attempt that sends it')
  })

  it('still retries a body-less Request object', async () => {
    const { tokens } = rotatingSession()
    const api = harness({ tokens, diagnostics }, staleTokenRejected)

    const response = await api.call(new Request(`${API}/v1/assets`))

    expect(response.status).toBe(200)
    expect(api.calls).toHaveLength(2)
    expect(authOf(at(api.calls, 1))).toBe('Bearer token-2')
    expect(reported).toHaveLength(0)
  })
})

describe('createAuthenticatedFetch: session failure and cancellation', () => {
  it('hands a failed refresh back as an ordinary 401, not as an error on the first mount', async () => {
    const refreshToken = vi.fn(async () => {
      throw new Error('refresh endpoint down')
    })
    const tokens = createSessionTokenService({ getToken: () => 'token-1', refreshToken })
    const api = harness({ tokens }, unauthorized)

    // A mount gets an ordinary 401 Response to handle in its data layer, not a framework
    // error to fail its mount with.
    const first = await api.call('assets')
    const second = await api.call('orders')

    expect(first.status).toBe(401)
    expect(second.status).toBe(401)
    expect(refreshToken).toHaveBeenCalled()
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
    const api = harness({ tokens }, staleTokenRejected)

    const leaving = new AbortController()
    const abandoned = api.call('assets', { signal: leaving.signal })
    const staying = api.call('orders')

    // Let both first attempts 401 and both callers reach the shared refresh.
    await flush()
    expect(refreshToken).toHaveBeenCalledTimes(1)

    leaving.abort()
    await expect(abandoned).rejects.toMatchObject({ name: 'AbortError' })

    releaseRefresh('token-2')
    const response = await staying
    expect(response.status).toBe(200)

    expect(refreshToken).toHaveBeenCalledTimes(1)
    expect(at(refreshSignals).aborted).toBe(false)
  })

  it('passes the caller signal through to the wrapped fetch', async () => {
    const api = harness()
    const controller = new AbortController()

    await api.call('assets', { signal: controller.signal })

    expect(at(api.calls).init?.signal).toBe(controller.signal)
  })
})

describe('createAuthTransport', () => {
  it('serves both tiers from one single-flight session', async () => {
    const refreshToken = vi.fn(async () => 'token-2')
    const tokens = createSessionTokenService({ getToken: () => null, refreshToken })
    const inner = fakeFetch(ok)

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
    expect(authOf(at(inner.calls))).toBe('Bearer token-2')
    expect(refreshToken).toHaveBeenCalledTimes(1)
  })
})
