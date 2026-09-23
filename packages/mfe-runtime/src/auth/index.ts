/**
 * The shell owns the session and satisfies `AccessTokenSource`; the framework adds the
 * token at the interceptor, and only for origins the author declared as APIs (§10).
 */

export {
  createSessionTokenService,
  DEFAULT_SESSION_ID,
  type AccessTokenOptions,
  type AccessTokenReader,
  type GetAccessToken,
  type SessionCallContext,
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

export {
  createContainerTransport,
  installShellAuth,
  type ContainerAuthBinding,
  type ShellAuthOptions,
} from './container-transport.ts'

export { normalizeAllowedOrigins, type AllowlistContext, type OriginAllowlist } from './origins.ts'
