/**
 * The shell's `AccessTokenSource` over an OIDC session held in memory only. Renewal is
 * single-flight for the page, because with rotating refresh tokens a second concurrent refresh
 * presents a credential the provider already retired (§10). Each tab signs in on its own and so
 * holds its own refresh token, which is why no coordination between tabs is needed.
 */

import type { AccessTokenOptions, AccessTokenSource } from '@company/mfe-react/host'

/** The part of an `oidc-client-ts` `User` this needs, so it is testable without one. */
export interface HeldToken {
  readonly access_token: string
  /** Seconds since the epoch, as the provider reported it. */
  readonly expires_at?: number | undefined
}

export interface OidcTokenSourceOptions {
  /** The session's current user, or nothing. */
  readonly current: () => Promise<HeldToken | null>
  /** A silent renewal: the refresh token grant, never a page navigation. */
  readonly renew: () => Promise<HeldToken | null>
  /** Renewal failed, so only a new sign-in can continue; called once. */
  readonly onSessionLost: (cause: unknown) => void
  /** Seconds since the epoch; injectable for tests. */
  readonly now?: () => number
  /** A token this close to expiry is renewed rather than sent, so it cannot lapse in flight. */
  readonly skewSeconds?: number
}

const DEFAULT_SKEW_SECONDS = 30

function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason
  return reason instanceof Error
    ? reason
    : new DOMException('The operation was aborted.', 'AbortError')
}

/** Only this caller stops waiting; the renewal others share carries on. */
function raceAbort<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return work
  if (signal.aborted) return Promise.reject(abortReason(signal))
  let onAbort: (() => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      reject(abortReason(signal))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
  return Promise.race([work, aborted]).finally(() => {
    if (onAbort !== undefined) signal.removeEventListener('abort', onAbort)
  })
}

export function createOidcTokenSource(options: OidcTokenSourceOptions): AccessTokenSource {
  const now = options.now ?? (() => Date.now() / 1000)
  const skew = options.skewSeconds ?? DEFAULT_SKEW_SECONDS
  let inFlight: Promise<string | null> | null = null
  let lost = false

  const usable = (held: HeldToken | null, rejected: string | undefined): held is HeldToken =>
    held !== null &&
    held.access_token !== '' &&
    held.access_token !== rejected &&
    (held.expires_at === undefined || held.expires_at - now() > skew)

  function renewOnce(): Promise<string | null> {
    if (inFlight !== null) return inFlight
    const started = options
      .renew()
      .then(held => {
        if (!usable(held, undefined)) throw new Error('Renewal returned no usable access token.')
        return held.access_token
      })
      .catch((cause: unknown) => {
        if (!lost) {
          lost = true
          options.onSessionLost(cause)
        }
        return null
      })
      .finally(() => {
        if (inFlight === started) inFlight = null
      })
    inFlight = started
    return started
  }

  return {
    getAccessToken: async (callOptions: AccessTokenOptions = {}) => {
      const { signal, rejectedToken } = callOptions
      if (signal?.aborted === true) throw abortReason(signal)
      if (lost) return null

      // Another caller may already have renewed past the token this one saw rejected.
      const held = await options.current()
      if (usable(held, rejectedToken)) return held.access_token

      return await raceAbort(renewOnce(), signal)
    },
  }
}
