import { describe, expect, it, vi, type Mock } from 'vitest'

import {
  createSessionTokenService,
  type GetAccessToken,
  type SessionCallContext,
} from './session.ts'
import { at, deferred } from '../__tests__/harness.ts'

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

function serviceFor(session: FakeSession): { readonly getAccessToken: GetAccessToken } {
  return createSessionTokenService({
    getToken: session.getToken,
    refreshToken: session.refreshToken,
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

describe('createSessionTokenService: a refresh the shell cannot complete', () => {
  it('resolves null to the caller rather than failing whichever mount fired first', async () => {
    const session = createFakeSession(null)
    session.refreshToken.mockRejectedValue(new Error('network down'))
    const tokens = serviceFor(session)

    await expect(tokens.getAccessToken()).resolves.toBeNull()
  })

  it('resolves null when the refresh completes without a token', async () => {
    const session = createFakeSession(null)
    session.refreshToken.mockResolvedValue(null)
    const tokens = serviceFor(session)

    await expect(tokens.getAccessToken()).resolves.toBeNull()
  })

  it('still refreshes only once for a whole burst of concurrent callers', async () => {
    const session = createFakeSession(null)
    const gate = deferred<string>()
    session.refreshToken.mockImplementation(() => gate.promise)
    const tokens = serviceFor(session)

    const pending = Array.from({ length: 4 }, () => tokens.getAccessToken())
    gate.reject(new Error('refresh token rotated away'))

    await expect(Promise.all(pending)).resolves.toEqual([null, null, null, null])
    expect(session.refreshToken).toHaveBeenCalledTimes(1)
  })

  it('stops believing the token it was holding, so the next call renews again', async () => {
    const session = createFakeSession('stored-token')
    const tokens = serviceFor(session)
    await tokens.getAccessToken()

    session.refreshToken.mockRejectedValueOnce(new Error('network down'))
    await expect(tokens.getAccessToken({ rejectedToken: 'stored-token' })).resolves.toBeNull()

    session.store.current = 'after-login'
    await expect(tokens.getAccessToken()).resolves.toBe('after-login')
  })

  it('keeps token material out of the error a cancelled caller is handed', async () => {
    const session = createFakeSession('s3cr3t-access-token')
    const tokens = serviceFor(session)
    await tokens.getAccessToken()

    const controller = new AbortController()
    controller.abort({ note: 'not an Error' })

    await expect(
      tokens.getAccessToken({ signal: controller.signal, rejectedToken: 's3cr3t-access-token' }),
    ).rejects.toSatisfy(
      (error: unknown) => !JSON.stringify((error as Error).message).includes('s3cr3t'),
    )
  })
})
