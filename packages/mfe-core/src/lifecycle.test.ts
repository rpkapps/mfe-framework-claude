import { describe, expect, it, vi } from 'vitest'

import { createMfeError } from './errors.ts'
import { MountLifecycle } from './lifecycle.ts'

function disposalReason() {
  return createMfeError({ code: 'dispose/failure', id: 'operations', operation: 'dispose' })
}

describe('MountLifecycle transitions', () => {
  it('starts pending at attempt 0 and reaches mounted through an attempt', () => {
    const lifecycle = new MountLifecycle({ id: 'operations' })
    expect(lifecycle.state).toEqual({ status: 'pending', attempt: 0 })

    const attempt = lifecycle.beginAttempt()
    expect(lifecycle.state).toEqual({ status: 'pending', attempt: 1 })

    lifecycle.settleMounted(attempt)
    expect(lifecycle.state).toEqual({ status: 'mounted' })
  })

  it('reuses the mounted snapshot so an input update republishes nothing', () => {
    const lifecycle = new MountLifecycle({ id: 'alert-panel' })
    const listener = vi.fn()
    lifecycle.subscribe(listener)

    const attempt = lifecycle.beginAttempt()
    lifecycle.settleMounted(attempt)
    const mounted = lifecycle.getState()
    listener.mockClear()

    expect(lifecycle.settleMounted(attempt)).toBe(false)
    expect(lifecycle.getState()).toBe(mounted)
    expect(listener).not.toHaveBeenCalled()
  })

  it('settles an attempt into an explicit error state', () => {
    const lifecycle = new MountLifecycle({ id: 'operations' })
    const attempt = lifecycle.beginAttempt()
    const error = createMfeError({ code: 'mount/failure', id: 'operations', operation: 'mount' })

    lifecycle.settleError(attempt, error)

    expect(lifecycle.getState()).toEqual({ status: 'error', error })
  })
})

describe('attempt fencing', () => {
  it('ignores a superseded attempt settling after a retry started', () => {
    const lifecycle = new MountLifecycle({ id: 'operations' })
    const first = lifecycle.beginAttempt()
    const second = lifecycle.beginAttempt()

    expect(first.isCurrent()).toBe(false)
    expect(second.isCurrent()).toBe(true)

    const stale = createMfeError({ code: 'load/timeout', id: 'operations', operation: 'load' })
    expect(lifecycle.settleError(first, stale)).toBe(false)
    expect(lifecycle.settleMounted(first)).toBe(false)
    expect(lifecycle.getState()).toEqual({ status: 'pending', attempt: 2 })
  })

  it('aborts the superseded attempt signal so its in-flight work cancels', () => {
    const lifecycle = new MountLifecycle({ id: 'operations' })
    const first = lifecycle.beginAttempt()
    expect(first.signal.aborted).toBe(false)

    lifecycle.beginAttempt()
    expect(first.signal.aborted).toBe(true)
  })

  it('increments the attempt number on every retry', () => {
    const lifecycle = new MountLifecycle({ id: 'operations' })
    lifecycle.beginAttempt()
    lifecycle.beginAttempt()
    const third = lifecycle.beginAttempt()

    expect(third.attempt).toBe(3)
    expect(lifecycle.currentAttempt).toBe(3)
  })
})

describe('disposal', () => {
  it('aborts the mount signal and moves to the terminal disposed state', () => {
    const lifecycle = new MountLifecycle({ id: 'operations' })
    const attempt = lifecycle.beginAttempt()
    lifecycle.settleMounted(attempt)

    expect(lifecycle.signal.aborted).toBe(false)
    lifecycle.markDisposed(disposalReason())

    expect(lifecycle.getState()).toEqual({ status: 'disposed' })
    expect(lifecycle.signal.aborted).toBe(true)
    expect(lifecycle.isDisposed).toBe(true)
  })

  it('is idempotent and publishes the disposed transition exactly once', () => {
    const lifecycle = new MountLifecycle({ id: 'operations' })
    const listener = vi.fn()
    lifecycle.subscribe(listener)

    lifecycle.markDisposed(disposalReason())
    lifecycle.markDisposed(disposalReason())

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('runs asynchronous cleanup once no matter how many callers await it', async () => {
    const lifecycle = new MountLifecycle({ id: 'operations' })
    const cleanup = vi.fn(async () => {})

    const first = lifecycle.runDisposalOnce(cleanup)
    const second = lifecycle.runDisposalOnce(cleanup)

    await Promise.all([first, second])
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(first).toBe(second)
  })

  it('refuses a new attempt after disposal with an actionable message', () => {
    const lifecycle = new MountLifecycle({ id: 'operations', definitionVersion: '2.1.0' })
    lifecycle.markDisposed(disposalReason())

    expect(() => lifecycle.beginAttempt()).toThrowError(
      /operations@2\.1\.0 failed to begin a mount attempt.*disposed mount.*Create a new mount/s,
    )
  })

  it('fences a late settle from an attempt that was running at disposal', () => {
    const lifecycle = new MountLifecycle({ id: 'operations' })
    const attempt = lifecycle.beginAttempt()
    lifecycle.markDisposed(disposalReason())

    expect(lifecycle.settleMounted(attempt)).toBe(false)
    expect(lifecycle.getState()).toEqual({ status: 'disposed' })
  })
})
