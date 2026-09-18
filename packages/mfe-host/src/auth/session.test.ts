import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import { DiagnosticsHub, type Diagnostic } from '@company/mfe-core'

import {
  createSessionTokenService,
  type SessionCallContext,
  type SessionFailure,
  type SessionTokenService,
  type SessionTokenServiceOptions,
} from './session.ts'

/** A promise whose settlement the test controls, so races are deterministic. */
function deferred<T>(): {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (reason: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

type TokenCall = (context: SessionCallContext) => Promise<string | null>

interface FakeSession {
  readonly getToken: Mock<TokenCall>
  readonly refreshToken: Mock<TokenCall>
  /** The signal each refresh was given, to prove it is not a caller's. */
  readonly refreshSignals: AbortSignal[]
  /** The token the shell currently holds; tests write to it directly. */
  readonly store: { current: string | null }
}

/**
 * A fake session store. `getToken` reads whatever the shell currently holds and
 * `refreshToken` rotates it, which is the shape a real shell has — and the shape
 * that makes a duplicated refresh visible as a second call.
 */
function createFakeSession(initial: string | null = null): FakeSession {
  const store = { current: initial }
  const refreshSignals: AbortSignal[] = []
  let issued = 0

  return {
    store,
    refreshSignals,
    getToken: vi.fn<TokenCall>(async () => store.current),
    refreshToken: vi.fn<TokenCall>(async context => {
      refreshSignals.push(context.signal)
      issued += 1
      store.current = `rotated-${issued}`
      return store.current
    }),
  }
}

function serviceFor(
  session: FakeSession,
  extra: Omit<SessionTokenServiceOptions, 'getToken' | 'refreshToken'> = {},
): SessionTokenService {
  return createSessionTokenService({
    getToken: session.getToken,
    refreshToken: session.refreshToken,
    ...extra,
  })
}

describe('createSessionTokenService: acquiring a token', () => {
  it('serves the token the shell already holds without refreshing', async () => {
    const session = createFakeSession('stored-token')
    const tokens = serviceFor(session)

    await expect(tokens.getAccessToken()).resolves.toBe('stored-token')
    expect(session.refreshToken).not.toHaveBeenCalled()
  })

  it('caches the token so a second call does not re-read the shell store', async () => {
    const session = createFakeSession('stored-token')
    const tokens = serviceFor(session)

    await tokens.getAccessToken()
    await tokens.getAccessToken()

    expect(session.getToken).toHaveBeenCalledTimes(1)
    expect(session.refreshToken).not.toHaveBeenCalled()
  })

  it('refreshes when the shell store has no token', async () => {
    const session = createFakeSession(null)
    const tokens = serviceFor(session)

    await expect(tokens.getAccessToken()).resolves.toBe('rotated-1')
    expect(session.refreshToken).toHaveBeenCalledTimes(1)
  })

  it('treats an empty or whitespace-only token as no token at all', async () => {
    const session = createFakeSession('   ')
    const tokens = serviceFor(session)

    await expect(tokens.getAccessToken()).resolves.toBe('rotated-1')
  })

  it('works when destructured, so it can be handed out as the escape hatch', async () => {
    const session = createFakeSession('stored-token')
    const { getAccessToken } = serviceFor(session)

    await expect(getAccessToken()).resolves.toBe('stored-token')
  })
})

describe('createSessionTokenService: single-flight refresh', () => {
  it('refreshes exactly once for many concurrent callers with no token', async () => {
    const session = createFakeSession(null)
    const gate = deferred<string>()
    session.refreshToken.mockImplementation((context: { signal: AbortSignal }) => {
      session.refreshSignals.push(context.signal)
      return gate.promise
    })
    const tokens = serviceFor(session)

    const pending = [
      tokens.getAccessToken(),
      tokens.getAccessToken(),
      tokens.getAccessToken(),
      tokens.getAccessToken(),
      tokens.getAccessToken(),
    ]
    gate.resolve('rotated-1')

    await expect(Promise.all(pending)).resolves.toEqual([
      'rotated-1',
      'rotated-1',
      'rotated-1',
      'rotated-1',
      'rotated-1',
    ])
    expect(session.refreshToken).toHaveBeenCalledTimes(1)
  })

  it('refreshes exactly once when many callers report the same rejected token', async () => {
    const session = createFakeSession('stored-token')
    const tokens = serviceFor(session)
    await tokens.getAccessToken()

    const gate = deferred<string>()
    session.refreshToken.mockImplementation(() => gate.promise)

    const pending = Array.from({ length: 6 }, () =>
      tokens.getAccessToken({ rejectedToken: 'stored-token' }),
    )
    gate.resolve('rotated-1')

    const results = await Promise.all(pending)
    expect(results.every(value => value === 'rotated-1')).toBe(true)
    expect(session.refreshToken).toHaveBeenCalledTimes(1)
  })

  it('serves the newer token to a caller that lost the race, without refreshing again', async () => {
    const session = createFakeSession('stored-token')
    const tokens = serviceFor(session)
    await tokens.getAccessToken()

    await expect(tokens.getAccessToken({ rejectedToken: 'stored-token' })).resolves.toBe(
      'rotated-1',
    )
    // A second caller still holding the old token has already been overtaken.
    await expect(tokens.getAccessToken({ rejectedToken: 'stored-token' })).resolves.toBe(
      'rotated-1',
    )
    expect(session.refreshToken).toHaveBeenCalledTimes(1)
  })

  it('skips the refresh when the shell store already moved to a different token', async () => {
    const session = createFakeSession('stored-token')
    const tokens = serviceFor(session)
    await tokens.getAccessToken()

    // Another tab refreshed and wrote the new token into the shared store.
    session.store.current = 'from-another-tab'

    await expect(tokens.getAccessToken({ rejectedToken: 'stored-token' })).resolves.toBe(
      'from-another-tab',
    )
    expect(session.refreshToken).not.toHaveBeenCalled()
  })
})

describe('createSessionTokenService: cancellation', () => {
  it('does not cancel a shared refresh when one caller gives up', async () => {
    const session = createFakeSession(null)
    const gate = deferred<string>()
    session.refreshToken.mockImplementation((context: { signal: AbortSignal }) => {
      session.refreshSignals.push(context.signal)
      return gate.promise
    })
    const tokens = serviceFor(session)

    const leaving = new AbortController()
    const abandoned = tokens.getAccessToken({ signal: leaving.signal })
    const waiting = tokens.getAccessToken()

    leaving.abort()
    await expect(abandoned).rejects.toMatchObject({ name: 'AbortError' })

    gate.resolve('rotated-1')
    await expect(waiting).resolves.toBe('rotated-1')

    expect(session.refreshToken).toHaveBeenCalledTimes(1)
    expect(session.refreshSignals[0]?.aborted).toBe(false)
  })

  it('rejects immediately for an already-aborted caller, without touching the session', async () => {
    const session = createFakeSession(null)
    const tokens = serviceFor(session)
    const controller = new AbortController()
    controller.abort(new Error('mount disposed'))

    await expect(tokens.getAccessToken({ signal: controller.signal })).rejects.toMatchObject({
      message: 'mount disposed',
    })
    expect(session.getToken).not.toHaveBeenCalled()
    expect(session.refreshToken).not.toHaveBeenCalled()
  })

  it('gives the refresh a signal of its own, not the caller’s', async () => {
    const session = createFakeSession(null)
    const tokens = serviceFor(session)
    const controller = new AbortController()

    await tokens.getAccessToken({ signal: controller.signal })
    const refreshSignal = session.refreshSignals[0]
    controller.abort()

    expect(refreshSignal).toBeDefined()
    expect(refreshSignal?.aborted).toBe(false)
  })
})

describe('createSessionTokenService: session failure', () => {
  let diagnostics: DiagnosticsHub
  let reported: Diagnostic[]

  beforeEach(() => {
    diagnostics = new DiagnosticsHub()
    reported = []
    diagnostics.add(diagnostic => reported.push(diagnostic))
  })

  it('reports a thrown refresh as a session event and resolves null to the caller', async () => {
    const session = createFakeSession(null)
    session.refreshToken.mockRejectedValue(new Error('network down'))
    const failures: SessionFailure[] = []
    const tokens = serviceFor(session, {
      onSessionFailure: failure => failures.push(failure),
      diagnostics,
    })

    // The caller that happened to fire first does not receive a mount error.
    await expect(tokens.getAccessToken()).resolves.toBeNull()

    expect(failures).toHaveLength(1)
    expect(failures[0]?.reason).toBe('refresh-failed')
    expect(failures[0]?.error.code).toBe('config/unreachable')
    expect(failures[0]?.error.message).toContain('re-authentication')
    expect(failures[0]?.error.cause).toBeInstanceOf(Error)
    expect(reported).toHaveLength(1)
    expect(reported[0]?.severity).toBe('error')
  })

  it('reports a refresh that returns no token as a rejected refresh credential', async () => {
    const session = createFakeSession(null)
    session.refreshToken.mockResolvedValue(null)
    const failures: SessionFailure[] = []
    const tokens = serviceFor(session, { onSessionFailure: failure => failures.push(failure) })

    await expect(tokens.getAccessToken()).resolves.toBeNull()
    expect(failures[0]?.reason).toBe('refresh-rejected')
    expect(failures[0]?.error.message).toContain('no longer accepted')
  })

  it('reports one session event for a whole burst of concurrent callers', async () => {
    const session = createFakeSession(null)
    const gate = deferred<string>()
    session.refreshToken.mockImplementation(() => gate.promise)
    const failures: SessionFailure[] = []
    const tokens = serviceFor(session, { onSessionFailure: failure => failures.push(failure) })

    const pending = Array.from({ length: 4 }, () => tokens.getAccessToken())
    gate.reject(new Error('refresh token rotated away'))

    await expect(Promise.all(pending)).resolves.toEqual([null, null, null, null])
    expect(failures).toHaveLength(1)
    expect(session.refreshToken).toHaveBeenCalledTimes(1)
  })

  it('latches the failure so a doomed refresh is not retried on every request', async () => {
    const session = createFakeSession(null)
    session.refreshToken.mockRejectedValue(new Error('network down'))
    const tokens = serviceFor(session)

    await tokens.getAccessToken()
    await tokens.getAccessToken()
    await tokens.getAccessToken()

    expect(session.refreshToken).toHaveBeenCalledTimes(1)
    expect(tokens.getSessionFailure()?.reason).toBe('refresh-failed')
  })

  it('resumes after the shell re-authenticates and calls invalidate', async () => {
    const session = createFakeSession(null)
    session.refreshToken.mockRejectedValueOnce(new Error('network down'))
    const tokens = serviceFor(session)

    await expect(tokens.getAccessToken()).resolves.toBeNull()

    session.store.current = 'after-login'
    tokens.invalidate()

    expect(tokens.getSessionFailure()).toBeNull()
    await expect(tokens.getAccessToken()).resolves.toBe('after-login')
  })

  it('notifies every subscriber, and one that throws does not silence the rest', async () => {
    const session = createFakeSession(null)
    session.refreshToken.mockRejectedValue(new Error('network down'))
    const seen: string[] = []
    const tokens = serviceFor(session, { diagnostics })

    tokens.subscribeToSessionFailure(() => {
      seen.push('first')
      throw new Error('subscriber exploded')
    })
    const unsubscribe = tokens.subscribeToSessionFailure(() => seen.push('second'))
    tokens.subscribeToSessionFailure(failure => seen.push(`third:${failure.reason}`))

    await tokens.getAccessToken()
    expect(seen).toEqual(['first', 'second', 'third:refresh-failed'])
    // The throwing subscriber is reported rather than swallowed.
    expect(reported.some(entry => entry.error.message.includes('session-failure'))).toBe(true)

    unsubscribe()
    tokens.invalidate()
    seen.length = 0
    await tokens.getAccessToken()
    expect(seen).toEqual(['first', 'third:refresh-failed'])
  })

  it('keeps token material out of every diagnostic it reports', async () => {
    const session = createFakeSession('s3cr3t-access-token')
    session.refreshToken.mockRejectedValue(new Error('network down'))
    const tokens = serviceFor(session, { diagnostics })

    await tokens.getAccessToken()
    await tokens.getAccessToken({ rejectedToken: 's3cr3t-access-token' })

    const serialized = JSON.stringify(
      reported.map(entry => ({ message: entry.error.message, context: entry.context })),
    )
    expect(serialized).not.toContain('s3cr3t-access-token')
  })

  it('does not latch a failure onto a session that invalidate already replaced', async () => {
    const session = createFakeSession(null)
    const gate = deferred<string>()
    session.refreshToken.mockImplementation(() => gate.promise)
    const failures: SessionFailure[] = []
    const tokens = serviceFor(session, { onSessionFailure: failure => failures.push(failure) })

    const abandoned = tokens.getAccessToken()
    // The shell re-authenticated while the old refresh was still in flight.
    session.store.current = 'after-login'
    tokens.invalidate()
    gate.reject(new Error('stale refresh token'))

    await expect(abandoned).resolves.toBeNull()
    expect(failures).toHaveLength(0)
    expect(tokens.getSessionFailure()).toBeNull()
    await expect(tokens.getAccessToken()).resolves.toBe('after-login')
  })
})
