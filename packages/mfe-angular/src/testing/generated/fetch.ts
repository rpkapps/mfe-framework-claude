/**
 * What `#mfe/fetch` resolves to in a test. The alias points here so the source under test still
 * calls `fetch` from `#mfe/fetch` and the test answers the request. The interceptor itself
 * is the production one; only the session and the network at the far end are replaced.
 */

import { createAuthenticatedFetch, type FetchLike } from '@company/mfe-runtime'
import { createMfeError } from '@company/mfe-core'

export type MfeFetchHandler = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Response | Promise<Response>

/** One recorded attempt, carrying the URL that actually went out. */
export interface MfeFetchRecord {
  readonly url: string
  readonly method: string
  readonly authorization: string | null
}

const TEST_ID = 'the test environment'

const NO_HANDLER: MfeFetchHandler = input => {
  throw createMfeError({
    code: 'config/unreachable',
    id: TEST_ID,
    operation: `answer ${input instanceof Request ? input.url : String(input)}`,
    expected: 'a request handler installed by the test',
    observed: 'nothing installed',
    repair:
      'Call setMfeFetch(request => new Response(…)) before rendering. A test that reaches the network is not a component test.',
  })
}

let handler: MfeFetchHandler = NO_HANDLER
let accessToken: string | null = 'test-access-token'
let apiBaseUrl: string | undefined
let declaredOrigins: readonly string[] = []
let recorded: MfeFetchRecord[] = []

/** The declared `{ api: true }` origins, with the base URL's own origin among them. */
export let apiOrigins: readonly string[] = Object.freeze([])

function refreshOrigins(): void {
  const all = apiBaseUrl === undefined ? declaredOrigins : [apiBaseUrl, ...declaredOrigins]
  apiOrigins = Object.freeze([...new Set(all.map(entry => new URL(entry).origin))])
}

/** The base a relative request resolves against; its origin joins the allowlist. */
export function setMfeApiBaseUrl(base: string): void {
  apiBaseUrl = base
  refreshOrigins()
}

/** Further declared API origins, for a container that calls more than one. */
export function setMfeApiOrigins(next: readonly string[]): void {
  declaredOrigins = [...next]
  refreshOrigins()
}

export function setMfeFetch(next: MfeFetchHandler): void {
  handler = next
}

/** `null` models a signed-out shell: no Authorization header is attached. */
export function setMfeAccessToken(next: string | null): void {
  accessToken = next
}

/** Every request that actually went out, with the URL the interceptor resolved. */
export function mfeRequests(): readonly MfeFetchRecord[] {
  return recorded
}

export function resetMfeFetch(): void {
  handler = NO_HANDLER
  accessToken = 'test-access-token'
  apiBaseUrl = undefined
  declaredOrigins = []
  apiOrigins = Object.freeze([])
  recorded = []
}

/** Records what the interceptor decided, then hands it to the test's handler. */
const record: FetchLike = async (input, init) => {
  const request = input instanceof Request ? input : new Request(input, init)
  recorded = [
    ...recorded,
    {
      url: request.url,
      method: request.method,
      authorization: new Headers(init?.headers).get('Authorization'),
    },
  ]
  return await handler(input, init)
}

export const fetch: FetchLike = (input, init) =>
  createAuthenticatedFetch({
    id: TEST_ID,
    ...(apiBaseUrl === undefined ? {} : { apiBaseUrl }),
    allowedOrigins: apiOrigins,
    tokens: { getAccessToken: () => Promise.resolve(accessToken) },
    fetch: record,
  })(input, init)

export function getAccessToken(): Promise<string | null> {
  return Promise.resolve(accessToken)
}
