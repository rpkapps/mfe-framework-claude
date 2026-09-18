/**
 * An optional single-flight adapter from a shell's refresh function to the
 * `AccessTokenSource` the interceptor needs.
 *
 * The framework does not own the session. A shell on Better Auth, Auth0 or MSAL
 * already dedupes concurrent refreshes and raises its own failure events, and
 * hands that library's accessor straight to `createAuthenticatedFetch`. This
 * helper is for a shell with no such library: it collapses a burst of
 * expired-token requests into one refresh, because with rotating refresh tokens
 * a second concurrent call presents a credential the server already retired.
 *
 * A failed refresh is the shell's event, not this helper's: `getAccessToken`
 * resolves to `null` so the mount that happened to fire first does not turn a
 * whole-session problem into its own mount error. The token itself is never
 * written to configuration, to browser storage, or to any diagnostic.
 */

import { toMfeError } from '@company/mfe-core'

/** Attribution used when the host does not bind the helper to a definition. */
export const DEFAULT_SESSION_ID = 'shell'

export interface SessionCallContext {
  /**
   * Aborts when the helper itself gives up. Deliberately not any one caller's
   * signal: a caller that cancels must not cancel a refresh the others are
   * still waiting for.
   */
  readonly signal: AbortSignal
}

/** Reads or renews the shell's token. Resolving with nothing means "no token". */
export type AccessTokenReader = (
  context: SessionCallContext,
) => string | null | undefined | Promise<string | null | undefined>

export interface AccessTokenOptions {
  /** Honoured while waiting for a shared refresh; it never cancels the refresh. */
  readonly signal?: AbortSignal
  /**
   * The token this caller already used and the resource server rejected. The
   * helper renews only while the session is still on that exact token, so a
   * burst of 401s shares one refresh and a caller that raced a refresh which
   * already completed is simply handed the newer token.
   */
  readonly rejectedToken?: string
}

/** Always awaited, called once per request or connection, never stored. */
export type GetAccessToken = (options?: AccessTokenOptions) => Promise<string | null>

export interface SessionTokenServiceOptions {
  readonly getToken: AccessTokenReader
  readonly refreshToken: AccessTokenReader
  readonly id?: string
}

/** Treats an absent, empty or whitespace-only value as "no token". */
function normalizeToken(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  return value.trim() === '' ? null : value
}

/**
 * `AbortSignal.reason` is untyped and a caller may abort with anything, so it is
 * narrowed here rather than forwarded blind: the rejection is always an `Error`
 * — the caller's own, or the platform `AbortError` callers match on by name —
 * while an exotic value survives as the cause.
 */
function abortReason(id: string, signal: AbortSignal): Error {
  const reason: unknown = signal.reason
  if (reason instanceof Error) return reason
  if (reason === undefined) return new DOMException('The operation was aborted.', 'AbortError')
  return toMfeError(reason, {
    code: 'config/unreachable',
    id,
    operation: 'wait for an access token',
    expected: 'the caller to abort with an Error, so the rejection carries a name and a message',
    declaredBy: 'The shell code that owns the aborting controller',
    repair: 'Call AbortController.abort() with no argument, or pass an Error.',
    note: 'The shared renewal is unaffected: only this caller stopped waiting for it.',
  })
}

/**
 * Awaits shared work while honouring the caller's cancellation: only this caller
 * stops waiting. Racing rather than re-wrapping is what keeps a rejection of the
 * shared work reaching the caller exactly as it was thrown.
 */
function awaitShared<T>(id: string, work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return work
  if (signal.aborted) return Promise.reject(abortReason(id, signal))

  let onAbort: (() => void) | undefined
  const cancelled = new Promise<never>((_resolve, reject) => {
    onAbort = (): void => {
      reject(abortReason(id, signal))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })

  return Promise.race([work, cancelled]).finally(() => {
    if (onAbort !== undefined) signal.removeEventListener('abort', onAbort)
  })
}

export function createSessionTokenService(options: SessionTokenServiceOptions): {
  readonly getAccessToken: GetAccessToken
} {
  const id = options.id ?? DEFAULT_SESSION_ID
  /** The token this helper currently believes is good. */
  let token: string | null = null
  /** The shared renewal. Its presence is what makes refresh single-flight. */
  let inFlight: Promise<string | null> | null = null

  async function renew(seen: string | null, signal: AbortSignal): Promise<string | null> {
    try {
      // The shell's own store may already hold a token this helper has not seen
      // — another tab refreshed, or this is the first request. Using it avoids a
      // refresh the session does not need.
      const stored = normalizeToken(await options.getToken({ signal }))
      token =
        stored !== null && stored !== seen
          ? stored
          : normalizeToken(await options.refreshToken({ signal }))
    } catch {
      // The shell's auth library owns the failure event. The helper only stops
      // believing in the token it was holding, so the next call tries again.
      token = null
    }
    return token
  }

  const getAccessToken: GetAccessToken = async (callOptions = {}) => {
    const signal = callOptions.signal
    if (signal?.aborted === true) throw abortReason(id, signal)

    const cached = token
    const rejected = callOptions.rejectedToken
    if (cached !== null && rejected !== cached) return cached

    let shared = inFlight
    if (shared === null) {
      // The renewal runs on a controller this helper owns, never a caller's.
      const started: Promise<string | null> = renew(cached, new AbortController().signal).finally(
        () => {
          if (inFlight === started) inFlight = null
        },
      )
      inFlight = started
      shared = started
    }

    return await awaitShared(id, shared, signal)
  }

  return { getAccessToken }
}
