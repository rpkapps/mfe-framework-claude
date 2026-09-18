/**
 * Authentication and transport for the host.
 *
 * Two tiers, one session. `createAuthenticatedFetch` covers everything that
 * speaks HTTP through `fetch`; `getAccessToken` on the session service is the
 * escape hatch for transports `fetch` cannot express — WebSocket, EventSource,
 * a library with its own HTTP stack. Both go through the same single-flight
 * refresh, so a burst of expired-token requests renews the session once.
 *
 * Nothing here patches a global, and no token value is ever written to
 * configuration, browser storage or a diagnostic.
 */

export {
  createSessionTokenService,
  DEFAULT_SESSION_ID,
  type AccessTokenOptions,
  type AccessTokenReader,
  type GetAccessToken,
  type SessionCallContext,
  type SessionFailure,
  type SessionFailureListener,
  type SessionFailureReason,
  type SessionRefresher,
  type SessionTokenService,
  type SessionTokenServiceOptions,
} from './session.ts'

export {
  createAuthenticatedFetch,
  createAuthTransport,
  DEFAULT_AUTH_ID,
  type AccessTokenSource,
  type AuthenticatedFetchOptions,
  type AuthTransport,
  type FetchLike,
} from './authenticated-fetch.ts'

export { normalizeAllowedOrigins, type AllowlistContext, type OriginAllowlist } from './origins.ts'
