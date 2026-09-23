/**
 * The authenticated `fetch` the shell hands to MFEs: a wrapper, never a patch, with the
 * standard `fetch` signature. Attaching a token is not authorization, so a 403 passes
 * through untouched.
 */

import { createMfeError, DEV } from '@company/mfe-core'

import type { DiagnosticsHub } from '../diagnostics.ts'
import { normalizeAllowedOrigins } from './origins.ts'
import type { AccessTokenOptions, GetAccessToken } from './session.ts'

/** Attribution used when the host does not bind the transport to a definition. */
export const DEFAULT_AUTH_ID = 'shell'

/** The standard `fetch` shape, so the result is a drop-in for any consumer. */
export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/** Narrow on purpose: the refresh machinery is reachable only through this. */
export interface AccessTokenSource {
  readonly getAccessToken: GetAccessToken
}

export interface AuthenticatedFetchOptions {
  /**
   * Structurally optional so a transport used only with absolute URLs can omit it; a relative
   * request with no base fails before any network activity.
   */
  readonly apiBaseUrl?: string | URL
  /** Origins the author declared as APIs; only these receive the bearer token. */
  readonly allowedOrigins: Iterable<string | URL>
  readonly tokens: AccessTokenSource
  readonly diagnostics?: DiagnosticsHub
  /** Gates developer-only warnings that would be noise in production. */
  readonly isDevelopment?: boolean
  /**
   * Defaults to a thin delegate that reads `globalThis.fetch` at call time — the global is read,
   * never written.
   */
  readonly fetch?: FetchLike
  /** Attribution for diagnostics, e.g. the definition this transport serves. */
  readonly id?: string
}

/** Both auth tiers wired to one session, so they cannot drift apart. */
export interface AuthTransport {
  readonly fetch: FetchLike
  /** The escape hatch for WebSocket, EventSource and foreign HTTP stacks. */
  readonly getAccessToken: GetAccessToken
}

type ReplayDecision =
  { readonly replayable: true } | { readonly replayable: false; readonly reason: string }

const REPLAYABLE: ReplayDecision = { replayable: true }

const STREAM_BODY_REASON =
  'a ReadableStream body, which is consumed as it is sent and cannot be read a second time'

const REQUEST_BODY_REASON =
  'a Request object carrying a body, which is consumed by the attempt that sends it'

function isRequest(value: unknown): value is Request {
  return typeof Request !== 'undefined' && value instanceof Request
}

function isStreamBody(body: BodyInit | null | undefined): boolean {
  return typeof ReadableStream !== 'undefined' && body instanceof ReadableStream
}

/** Token-service options, built without tripping `exactOptionalPropertyTypes`. */
function tokenOptions(signal: AbortSignal | undefined, rejectedToken?: string): AccessTokenOptions {
  return {
    ...(signal === undefined ? {} : { signal }),
    ...(rejectedToken === undefined ? {} : { rejectedToken }),
  }
}

function parseApiBaseUrl(value: string | URL | undefined, id: string): URL | null {
  if (value === undefined) return null

  const raw = typeof value === 'string' ? value.trim() : value.href
  const invalid = (observed: string, repair: string): never => {
    throw createMfeError({
      code: 'config/invalid',
      id,
      operation: 'accept apiBaseUrl',
      expected: 'an absolute http(s) URL such as "https://api.example.test/v1/"',
      observed,
      repair,
    })
  }

  if (raw === '') {
    return invalid(
      'an empty string',
      'Supply the API base URL, or check the environment variable that was meant to provide it — an unsubstituted variable leaves an empty string here.',
    )
  }

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return invalid(
      `${JSON.stringify(raw)}, which is not an absolute URL`,
      'Write the full base including the scheme. A relative base cannot be used: request URLs resolve against the API, deliberately not against the shell document URL.',
    )
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return invalid(
      `the ${parsed.protocol.replace(':', '')} URL ${JSON.stringify(raw)}`,
      'Use an http(s) base URL.',
    )
  }

  return parsed
}

/** Plain `new URL(input, base)`, so a trailing slash on the base is significant as usual. */
function resolveRequestUrl(input: RequestInfo | URL, base: URL | null, id: string): URL {
  if (isRequest(input)) return new URL(input.url)

  const raw = typeof input === 'string' ? input : input.href

  try {
    return new URL(raw)
  } catch {
    // Not absolute: the configured base is now required.
  }

  if (base === null) {
    throw createMfeError({
      code: 'config/missing',
      id,
      operation: 'resolve the request URL',
      expected: 'an absolute URL, or an apiBaseUrl to resolve a relative one against',
      observed: `the relative URL ${JSON.stringify(raw)} and no configured apiBaseUrl`,
      repair:
        'Set apiBaseUrl (for example "https://api.example.test/v1/"), or pass an absolute URL. A relative URL is never resolved against the shell document URL, so this request had no base and was not sent.',
    })
  }

  try {
    return new URL(raw, base)
  } catch {
    throw createMfeError({
      code: 'config/invalid',
      id,
      operation: 'resolve the request URL',
      expected: `a URL that resolves against the configured base ${JSON.stringify(base.href)}`,
      observed: `${JSON.stringify(raw)}, which is not a resolvable URL reference`,
      repair: 'Correct the request URL; it was not sent.',
    })
  }
}

/** The framework does not buffer a caller's upload just in case a 401 arrives. */
function decideRequestReplay(request: Request, init: RequestInit | undefined): ReplayDecision {
  if (isStreamBody(init?.body)) return { replayable: false, reason: STREAM_BODY_REASON }
  if (request.bodyUsed || request.body !== null) {
    return { replayable: false, reason: REQUEST_BODY_REASON }
  }
  return REPLAYABLE
}

interface RequestPlan {
  readonly method: string
  /** The caller's cancellation, as `fetch` itself would resolve it. */
  readonly signal: AbortSignal | undefined
  readonly hasCallerAuthorization: boolean
  readonly replay: ReplayDecision
  /** Issues one attempt, applying `authorization` when it is not `null`. */
  readonly send: (authorization: string | null) => Promise<Response>
}

/** Described once, so both attempts differ only in the `Authorization` header. */
function planRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  url: URL,
  innerFetch: FetchLike,
): RequestPlan {
  if (isRequest(input)) {
    const request = input
    // `fetch(request, init)` lets init replace the request's headers wholesale,
    // which is also what the Request constructor does.
    const headerSource = init?.headers === undefined ? request.headers : new Headers(init.headers)
    const snapshot = new Headers(headerSource)

    const replay = decideRequestReplay(request, init)

    return {
      method: request.method.toUpperCase(),
      signal: init?.signal ?? request.signal,
      hasCallerAuthorization: snapshot.has('authorization'),
      replay,
      send: authorization => {
        const headers = new Headers(snapshot)
        if (authorization !== null) headers.set('Authorization', authorization)
        let attempt: Request
        try {
          attempt = new Request(request, { ...init, headers })
        } catch {
          // Already-consumed requests cannot be rebuilt, so the caller's own object goes
          // through rather than a different request.
          return innerFetch(request, init)
        }
        return innerFetch(attempt)
      },
    }
  }

  const snapshot = new Headers(init?.headers)

  return {
    method: (init?.method ?? 'GET').toUpperCase(),
    signal: init?.signal ?? undefined,
    hasCallerAuthorization: snapshot.has('authorization'),
    replay: isStreamBody(init?.body)
      ? { replayable: false, reason: STREAM_BODY_REASON }
      : REPLAYABLE,
    send: authorization => {
      const headers = new Headers(snapshot)
      if (authorization !== null) headers.set('Authorization', authorization)
      // The resolved absolute URL is what actually goes out, so that is what the wrapped
      // implementation receives.
      return innerFetch(url.href, { ...init, headers })
    },
  }
}

/** Nothing global is modified; the wrapped implementation's `Response` is returned unchanged. */
export function createAuthenticatedFetch(options: AuthenticatedFetchOptions): FetchLike {
  const id = options.id ?? DEFAULT_AUTH_ID
  const isDevelopment = options.isDevelopment ?? false
  const diagnostics = options.diagnostics
  const tokens = options.tokens

  const base = parseApiBaseUrl(options.apiBaseUrl, id)
  const allowlist = normalizeAllowedOrigins(options.allowedOrigins, {
    id,
    operation: 'accept the declared API origins',
  })

  // Read at call time and never assigned: the global stays the browser's.
  const innerFetch: FetchLike = options.fetch ?? ((input, init) => globalThis.fetch(input, init))

  // One warning per origin per transport: repeated on every request it would bury the
  // rest of the console.
  const warnedOrigins = new Set<string>()

  function warnUndeclaredOrigin(origin: string, method: string): void {
    // Guarded at compile time as well as at run time, so a production build drops the
    // branch, the set it consults and the long sentence it would have written.
    if (!DEV) return
    if (!isDevelopment || diagnostics === undefined) return
    if (warnedOrigins.has(origin)) return
    warnedOrigins.add(origin)

    diagnostics.report(
      createMfeError({
        code: 'auth/undeclared-origin',
        id,
        operation: `attach the access token for ${origin}`,
        expected: 'a request to an origin the author declared as an API with { api: true }',
        observed: `a request to ${origin}, which is not declared`,
        repair: `Declare ${origin} with { api: true } if it is your API, or leave it undeclared if it must never receive the session bearer token. It was sent without one, so an endpoint that requires it answers 401 — that 401 is this missing declaration, not a broken token.`,
      }),
      { severity: 'warning', context: { origin, method } },
    )
  }

  function warnNotReplayable(origin: string, method: string, reason: string): void {
    diagnostics?.report(
      createMfeError({
        code: 'config/invalid',
        id,
        operation: `retry ${method} ${origin} after 401`,
        expected: 'a request the framework can send a second time',
        observed: reason,
        repair:
          'Buffer the body before sending it — a string, Blob, ArrayBuffer, FormData or URLSearchParams can be replayed — or handle the 401 at the call site. The original 401 is returned unchanged and the token was refreshed, so the next request is authenticated.',
      }),
      { severity: 'warning', context: { origin, method } },
    )
  }

  return async function authenticatedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    // Configuration failures happen here, before anything is sent.
    const url = resolveRequestUrl(input, base, id)
    const plan = planRequest(input, init, url, innerFetch)

    if (!allowlist.has(url.origin)) {
      warnUndeclaredOrigin(url.origin, plan.method)
      return await plan.send(null)
    }

    // An explicit Authorization header is the caller's own credential, which the framework
    // neither replaces nor refreshes on its behalf.
    if (plan.hasCallerAuthorization) return await plan.send(null)

    const token = await tokens.getAccessToken(tokenOptions(plan.signal))
    const response = await plan.send(token === null ? null : `Bearer ${token}`)

    // A 401 on a request that carried no framework token is not something a refresh can
    // fix: the session has already failed and the shell is re-authenticating.
    if (response.status !== 401 || token === null) return response

    if (!plan.replay.replayable) {
      warnNotReplayable(url.origin, plan.method, plan.replay.reason)
      // Renew anyway: the next request would otherwise go out with the same rejected token.
      await tokens.getAccessToken(tokenOptions(plan.signal, token))
      return response
    }

    const refreshed = await tokens.getAccessToken(tokenOptions(plan.signal, token))
    // Exactly one retry, expressed structurally: there is no loop to bound.
    if (refreshed === null || refreshed === token) return response
    return await plan.send(`Bearer ${refreshed}`)
  }
}

/** Both tiers on one session, so they share the same single-flight refresh. */
export function createAuthTransport(options: AuthenticatedFetchOptions): AuthTransport {
  return {
    fetch: createAuthenticatedFetch(options),
    getAccessToken: options.tokens.getAccessToken,
  }
}
