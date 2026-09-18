/**
 * The shell-owned session and access-token service.
 *
 * Three rules shape this module, and each one exists because the obvious
 * alternative breaks in production:
 *
 * 1. Refresh is single-flight. When several mounts fire requests against the
 *    same expired token, exactly one refresh runs and every caller waits on it.
 *    Per-MFE refresh means concurrent refresh calls, and with rotating refresh
 *    tokens the second call presents a token the server has already retired,
 *    which logs the user out for no reason.
 * 2. A failed refresh is a session-level event, not a request error. It reaches
 *    the shell through the session-failure channel so the shell can start
 *    re-authentication once. `getAccessToken` resolves to `null` instead of
 *    rejecting, so the mount that happened to fire first does not turn a
 *    whole-session problem into its own mount error.
 * 3. One caller's cancellation never cancels the shared refresh. The refresh
 *    runs on a controller this service owns; callers race their own signal
 *    against the shared promise, so an unmounting MFE stops waiting without
 *    stranding the mounts that still need the new token.
 *
 * The token itself never leaves this module except as a return value handed
 * straight to a transport. It is not written to configuration, to browser
 * storage, or to any diagnostic.
 */

import { createMfeError, ListenerSet, toMfeError } from '@company/mfe-core'
import type { DiagnosticsHub, MfeError, Unsubscribe } from '@company/mfe-core'

/** Attribution used when the host does not bind the service to a definition. */
export const DEFAULT_SESSION_ID = 'shell'

/**
 * Why the session could not produce a usable token.
 *
 * `refresh-failed` — the refresh call threw (transport, endpoint, or a shell
 * handler that rejected). Retrying later may succeed.
 *
 * `refresh-rejected` — the refresh call completed without a usable token. The
 * refresh credential itself was rejected or rotated away; only interactive
 * re-authentication recovers.
 */
export type SessionFailureReason = 'refresh-failed' | 'refresh-rejected'

export interface SessionFailure {
  readonly reason: SessionFailureReason
  /** Structured, developer-readable, and free of any token material. */
  readonly error: MfeError
  readonly timestamp: number
}

export type SessionFailureListener = (failure: SessionFailure) => void

export interface SessionCallContext {
  /**
   * Aborts when the service itself gives up on the renewal. It is deliberately
   * not any single caller's signal: a caller that cancels must not cancel a
   * refresh the other callers are still waiting for.
   */
  readonly signal: AbortSignal
}

/** Reads the token the shell currently holds, or `null` when it has none. */
export type AccessTokenReader = (
  context: SessionCallContext,
) => string | null | undefined | Promise<string | null | undefined>

/** Renews the session and resolves with the new access token. */
export type SessionRefresher = AccessTokenReader

export interface AccessTokenOptions {
  /**
   * The caller's cancellation. Honored while waiting for a shared refresh; it
   * does not cancel the refresh itself.
   */
  readonly signal?: AbortSignal
  /**
   * The token this caller already used and that the resource server rejected.
   * The service renews only while the session is still on that exact token, so
   * a burst of 401s shares one refresh, and a caller that raced a refresh which
   * already completed is simply handed the newer token.
   */
  readonly rejectedToken?: string
}

/**
 * The tier-two accessor for transports `fetch` cannot cover — WebSocket,
 * EventSource, libraries with their own HTTP stack. Always awaited, called once
 * per connection, never stored.
 */
export type GetAccessToken = (options?: AccessTokenOptions) => Promise<string | null>

export interface SessionTokenService {
  readonly getAccessToken: GetAccessToken
  /**
   * Drops the cached token and clears a latched session failure. The shell
   * calls this after sign-in, sign-out, or a completed re-authentication — that
   * is, whenever the session changed underneath the service.
   */
  readonly invalidate: () => void
  /** Notified on every session failure. Late subscribers use `getSessionFailure`. */
  readonly subscribeToSessionFailure: (listener: SessionFailureListener) => Unsubscribe
  /** The latched failure, or `null` while the session is healthy. */
  readonly getSessionFailure: () => SessionFailure | null
}

export interface SessionTokenServiceOptions {
  readonly getToken: AccessTokenReader
  readonly refreshToken: SessionRefresher
  /** Convenience for the shell's primary handler; equivalent to subscribing. */
  readonly onSessionFailure?: SessionFailureListener
  readonly diagnostics?: DiagnosticsHub
  readonly id?: string
}

/** Treats an absent, empty or whitespace-only value as "no token". */
function normalizeToken(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  return value.trim() === '' ? null : value
}

function abortReason(signal: AbortSignal): unknown {
  const reason: unknown = signal.reason
  if (reason !== undefined) return reason
  return new DOMException('The operation was aborted.', 'AbortError')
}

/**
 * Awaits shared work while honoring the caller's cancellation. The shared
 * promise keeps running; only this caller stops waiting for it.
 */
function awaitShared<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return work
  if (signal.aborted) return Promise.reject(abortReason(signal))

  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(abortReason(signal))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    work.then(
      value => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

/**
 * Builds the session/token service. Every dependency is injected, so tests and
 * the dev shell can drive it without a network.
 */
export function createSessionTokenService(
  options: SessionTokenServiceOptions,
): SessionTokenService {
  const id = options.id ?? DEFAULT_SESSION_ID
  const diagnostics = options.diagnostics

  /** The token this service currently believes is good. */
  let token: string | null = null
  /** Latched failure: while set, the service stops asking for a doomed refresh. */
  let failure: SessionFailure | null = null
  /** Bumped by `invalidate` so a renewal started before it cannot cache its result. */
  let generation = 0
  /** The shared renewal. Its presence is what makes refresh single-flight. */
  let inFlight: Promise<string | null> | null = null
  /** Read by subscriber adapters at notification time. */
  let pending: SessionFailure | null = null

  const listeners = new ListenerSet(error => {
    diagnostics?.report(
      toMfeError(error, {
        code: 'config/unreachable',
        id,
        operation: 'deliver the session-failure notification',
        expected: 'the shell session-failure handler to return',
        declaredBy: 'The shell that subscribed to session failures',
        repair:
          'Fix the throwing handler: if it does not run, re-authentication never starts and every later request goes out unauthenticated.',
      }),
      { severity: 'error' },
    )
  })

  if (options.onSessionFailure !== undefined) {
    const handler = options.onSessionFailure
    listeners.add(() => {
      if (pending !== null) handler(pending)
    })
  }

  function failSession(reason: SessionFailureReason, cause: unknown): void {
    const error =
      reason === 'refresh-failed'
        ? toMfeError(cause, {
            code: 'config/unreachable',
            id,
            operation: 'renew the session',
            expected: 'the refresh endpoint to return a new access token',
            declaredBy: 'The shell that owns the session',
            repair:
              'Send the user through re-authentication. Requests issued in the meantime go out unauthenticated and answer 401.',
            note: 'This is a session-level failure, not a failure of whichever mount happened to fire the first request.',
          })
        : createMfeError({
            code: 'config/unreachable',
            id,
            operation: 'renew the session',
            expected: 'the refresh endpoint to return a new access token',
            observed: 'it returned no token, so the refresh credential is no longer accepted',
            declaredBy: 'The shell that owns the session',
            repair:
              'Send the user through re-authentication, then call invalidate() so the service resumes issuing tokens.',
            note: 'This is a session-level failure, not a failure of whichever mount happened to fire the first request.',
          })

    token = null
    failure = { reason, error, timestamp: Date.now() }
    diagnostics?.report(error, { severity: 'error', context: { reason } })

    const previous = pending
    pending = failure
    try {
      listeners.notify()
    } finally {
      pending = previous
    }
  }

  async function runRenewal(
    seen: string | null,
    signal: AbortSignal,
    startedAt: number,
  ): Promise<string | null> {
    let refreshed: string | null
    try {
      // The shell's own store may already hold a token this service has not
      // seen — another tab refreshed, or this is the very first request. Using
      // it costs nothing and avoids a refresh the session does not need.
      const stored = normalizeToken(await options.getToken({ signal }))
      if (stored !== null && stored !== seen) {
        if (generation === startedAt) token = stored
        return stored
      }
      refreshed = normalizeToken(await options.refreshToken({ signal }))
    } catch (cause) {
      // A renewal `invalidate` superseded describes a session that no longer
      // exists; reporting it would latch a failure onto the new session.
      if (generation === startedAt) failSession('refresh-failed', cause)
      return null
    }

    if (refreshed === null) {
      if (generation === startedAt) failSession('refresh-rejected', undefined)
      return null
    }

    // A renewal that `invalidate` superseded still answers its waiters, but it
    // must not reinstate a token for a session that has since changed.
    if (generation === startedAt) {
      token = refreshed
      failure = null
    }
    return refreshed
  }

  /**
   * Starts the renewal, or joins the one already running. Callers reach this
   * synchronously after reading `token`, so there is no window in which two
   * callers can each start one.
   */
  function startOrJoinRenewal(seen: string | null): Promise<string | null> {
    const existing = inFlight
    if (existing !== null) return existing

    const startedAt = generation
    // Owned by the service, never a caller's signal.
    const controller = new AbortController()
    const promise = runRenewal(seen, controller.signal, startedAt).finally(() => {
      if (inFlight === promise) inFlight = null
    })
    inFlight = promise
    return promise
  }

  const getAccessToken: GetAccessToken = async (callOptions = {}) => {
    const signal = callOptions.signal
    if (signal?.aborted === true) throw abortReason(signal)

    const cached = token
    const rejected = callOptions.rejectedToken
    const mustRenew = cached === null || (rejected !== undefined && rejected === cached)
    if (!mustRenew) return cached

    // A latched failure means the refresh credential is gone. Asking again once
    // per request would hammer the endpoint and delay every mount for nothing;
    // the shell has already been told to re-authenticate.
    if (failure !== null) return null

    return awaitShared(startOrJoinRenewal(cached), signal)
  }

  return {
    getAccessToken,
    invalidate: () => {
      token = null
      failure = null
      generation += 1
    },
    subscribeToSessionFailure: listener =>
      listeners.add(() => {
        if (pending !== null) listener(pending)
      }),
    getSessionFailure: () => failure,
  }
}
