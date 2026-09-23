import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { isMfeError } from '@company/mfe-core'

import { DEFAULT_DEADLINES, withDeadline, type DeadlineContext } from './deadline.ts'

const loadContext: DeadlineContext = {
  id: 'operations',
  definitionVersion: '2.1.0',
  operation: 'load container',
  phase: 'load',
}

describe('withDeadline', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves normally and clears its timer', async () => {
    const promise = withDeadline(async () => 'ready', 1_000, loadContext)
    await expect(promise).resolves.toBe('ready')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects with a structured timeout naming the phase, definition and deadline', async () => {
    const promise = withDeadline(() => new Promise<never>(() => {}), 30_000, loadContext)
    const assertion = expect(promise).rejects.toMatchObject({ code: 'load/timeout' })

    await vi.advanceTimersByTimeAsync(30_000)
    await assertion

    await promise.catch((error: unknown) => {
      expect(isMfeError(error)).toBe(true)
      expect((error as Error).message).toContain('operations@2.1.0')
      expect((error as Error).message).toContain('within 30000ms')
      expect((error as Error).message).toContain('then retry')
    })
  })

  it('aborts the work signal so cancellable work stops at expiry', async () => {
    let observed: AbortSignal | undefined
    const promise = withDeadline(
      signal =>
        new Promise<never>(() => {
          observed = signal
        }),
      500,
      loadContext,
    ).catch(() => 'timed out')

    await vi.advanceTimersByTimeAsync(500)
    await promise

    expect(observed?.aborted).toBe(true)
  })

  it('runs onTimeout before rejecting so the caller can detach incomplete UI', async () => {
    const onTimeout = vi.fn()
    const promise = withDeadline(() => new Promise<never>(() => {}), 100, loadContext, {
      onTimeout,
    }).catch(() => undefined)

    await vi.advanceTimersByTimeAsync(100)
    await promise

    expect(onTimeout).toHaveBeenCalledTimes(1)
    expect(onTimeout.mock.calls[0]?.[0]).toMatchObject({ code: 'load/timeout' })
  })

  it('propagates an outer abort into the work signal', async () => {
    const outer = new AbortController()
    let observed: AbortSignal | undefined

    const promise = withDeadline(
      signal =>
        new Promise<never>((_resolve, reject) => {
          observed = signal
          signal.addEventListener('abort', () => reject(new Error('cancelled')))
        }),
      10_000,
      loadContext,
      { signal: outer.signal },
    ).catch(() => 'cancelled')

    outer.abort(new Error('host cancelled'))
    await promise

    expect(observed?.aborted).toBe(true)
  })

  it('maps each phase to its own timeout code', async () => {
    for (const [phase, code] of [
      ['load', 'load/timeout'],
      ['mount', 'mount/timeout'],
      ['dispose', 'dispose/timeout'],
    ] as const) {
      const promise = withDeadline(() => new Promise<never>(() => {}), 10, {
        ...loadContext,
        phase,
      }).catch((error: unknown) => (error as { code: string }).code)

      await vi.advanceTimersByTimeAsync(10)
      await expect(promise).resolves.toBe(code)
    }
  })

  it('documents the initial default deadlines', () => {
    expect(DEFAULT_DEADLINES).toEqual({ load: 30_000, mount: 30_000, dispose: 5_000 })
  })
})
