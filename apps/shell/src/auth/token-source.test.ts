import { describe, expect, it, vi } from 'vitest'

import { createOidcTokenSource, type HeldToken } from './token-source.ts'

const NOW = 1_000_000

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(settle => {
    resolve = settle
  })
  return { promise, resolve }
}

function harness(initial: HeldToken | null) {
  let held = initial
  const renewal = deferred<HeldToken | null>()
  const renew = vi.fn(async () => {
    const next = await renewal.promise
    held = next
    return next
  })
  const onSessionLost = vi.fn()
  const source = createOidcTokenSource({
    current: () => Promise.resolve(held),
    renew,
    onSessionLost,
    now: () => NOW,
  })
  return { source, renew, renewal, onSessionLost }
}

describe('createOidcTokenSource', () => {
  it('returns the held token while it is comfortably valid', async () => {
    const { source, renew } = harness({ access_token: 'a', expires_at: NOW + 300 })
    await expect(source.getAccessToken()).resolves.toBe('a')
    expect(renew).not.toHaveBeenCalled()
  })

  it('renews a token about to expire rather than sending it', async () => {
    const { source, renew, renewal } = harness({ access_token: 'a', expires_at: NOW + 10 })
    const token = source.getAccessToken()
    renewal.resolve({ access_token: 'b', expires_at: NOW + 300 })
    await expect(token).resolves.toBe('b')
    expect(renew).toHaveBeenCalledTimes(1)
  })

  it('collapses a burst of rejected-token calls into one renewal', async () => {
    const { source, renew, renewal } = harness({ access_token: 'a', expires_at: NOW + 300 })
    const burst = [1, 2, 3].map(() => source.getAccessToken({ rejectedToken: 'a' }))
    renewal.resolve({ access_token: 'b', expires_at: NOW + 300 })
    await expect(Promise.all(burst)).resolves.toEqual(['b', 'b', 'b'])
    expect(renew).toHaveBeenCalledTimes(1)
  })

  it('hands a caller whose token was already replaced the new one without renewing', async () => {
    const { source, renew } = harness({ access_token: 'b', expires_at: NOW + 300 })
    await expect(source.getAccessToken({ rejectedToken: 'a' })).resolves.toBe('b')
    expect(renew).not.toHaveBeenCalled()
  })

  it('reports the session lost once when renewal fails, and stops asking', async () => {
    const { source, renew, renewal, onSessionLost } = harness(null)
    const first = source.getAccessToken()
    const second = source.getAccessToken()
    renewal.resolve(null)
    await expect(Promise.all([first, second])).resolves.toEqual([null, null])
    await expect(source.getAccessToken()).resolves.toBeNull()
    expect(onSessionLost).toHaveBeenCalledTimes(1)
    expect(renew).toHaveBeenCalledTimes(1)
  })

  it("lets one caller's abort stop only its own wait", async () => {
    const { source, renewal } = harness(null)
    const controller = new AbortController()
    const aborted = source.getAccessToken({ signal: controller.signal })
    const waiting = source.getAccessToken()
    controller.abort()
    await expect(aborted).rejects.toThrow(/abort/i)
    renewal.resolve({ access_token: 'b' })
    await expect(waiting).resolves.toBe('b')
  })
})
