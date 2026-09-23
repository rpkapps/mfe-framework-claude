/**
 * An opt-in single-flight adapter for a shell with no auth library of its own: a burst of
 * expired-token requests collapses into one refresh, because with rotating refresh tokens a
 * second concurrent call presents a credential the server already retired (§10). The token
 * is never written to configuration, to browser storage, or to any diagnostic.
 */

import { toMfeError } from '@company/mfe-core'

/** Attribution used when the host does not bind the helper to a definition. */
export const DEFAULT_SESSION_ID = 'shell'

export interface SessionCallContext {
  /** Never one caller's signal: a caller that cancels must not cancel a refresh others await. */
  readonly signal: AbortSignal
}

/** Reads or renews the shell's token; resolving with nothing means "no token". */
export type AccessTokenReader = (
  context: SessionCallContext,
) => string | null | undefined | Promise<string | null | undefined>

export interface AccessTokenOptions {
  /** Honoured while waiting for a shared refresh; it never cancels the refresh. */
  readonly signal?: AbortSignal
  /** Renewal happens only while the session is still on this token, so 401s share one refresh. */
  readonly rejectedToken?: string
}

/** Always awaited, called once per request or connection, never stored. */
export type GetAccessToken = (options?: AccessTokenOptions) => Promise<string | null>

export interface SessionTokenServiceOptions {
  readonly getToken: AccessTokenReader
  readonly refreshToken: AccessTokenReader
  readonly id?: string
}

function normalizeToken(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  return value.trim() === '' ? null : value
}

/**
 * `AbortSignal.reason` is untyped, so it is narrowed here: the rejection is always an
 * `Error`, the caller's own or the platform `AbortError`, with an exotic value as its cause.
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
    repair: 'Call AbortController.abort() with no argument, or pass an Error.',
  })
}

/** Racing rather than re-wrapping lets only this caller stop waiting, with the rejection intact. */
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
  let token: string | null = null
  /** Its presence is what makes refresh single-flight. */
  let inFlight: Promise<string | null> | null = null

  async function renew(seen: string | null, signal: AbortSignal): Promise<string | null> {
    try {
      // The shell's own store may already hold a token this helper has not seen, so using
      // it avoids a refresh the session does not need.
      const stored = normalizeToken(await options.getToken({ signal }))
      token =
        stored !== null && stored !== seen
          ? stored
          : normalizeToken(await options.refreshToken({ signal }))
    } catch {
      // The shell's auth library owns the failure event; the helper only stops believing
      // in the token it was holding, so the next call tries again.
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
