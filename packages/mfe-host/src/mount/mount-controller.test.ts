import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DiagnosticsHub,
  isMfeError,
  type DeadlineConfig,
  type Diagnostic,
  type MountState,
} from '@company/mfe-core'

import { MountController, type MountOperations } from './mount-controller.ts'

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

interface TestModule {
  readonly name: string
}

const MODULE: TestModule = { name: 'reports' }
const SECOND_MODULE: TestModule = { name: 'reports-retry' }

const DEADLINES: DeadlineConfig = Object.freeze({ load: 30_000, mount: 30_000, dispose: 5_000 })

function recordingDiagnostics(): { readonly hub: DiagnosticsHub; readonly records: Diagnostic[] } {
  const records: Diagnostic[] = []
  const hub = new DiagnosticsHub()
  hub.add(diagnostic => records.push(diagnostic))
  return { hub, records }
}

interface Deferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (reason: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

function operations(overrides: Partial<MountOperations<TestModule>> = {}): MountOperations<TestModule> {
  return {
    load: overrides.load ?? (async () => MODULE),
    attach: overrides.attach ?? (async () => undefined),
    detach: overrides.detach ?? ((): void => undefined),
    cleanup: overrides.cleanup ?? (async () => undefined),
  }
}

function createController(
  ops: MountOperations<TestModule>,
  extras: { readonly deadlines?: DeadlineConfig; readonly onDisposed?: () => void } = {},
): {
  readonly controller: MountController<TestModule>
  readonly records: Diagnostic[]
} {
  const { hub, records } = recordingDiagnostics()
  const controller = new MountController<TestModule>({
    id: 'reports',
    definitionVersion: '2.1.0',
    operations: ops,
    deadlines: extras.deadlines ?? DEADLINES,
    diagnostics: hub,
    ...(extras.onDisposed === undefined ? {} : { onDisposed: extras.onDisposed }),
  })
  return { controller, records }
}

function errorStateOf(state: MountState): { readonly code: string; readonly message: string } {
  if (state.status !== 'error') throw new Error(`expected an error state, saw "${state.status}"`)
  return { code: state.error.code, message: state.error.message }
}

/** Lets already-queued microtasks and callbacks run under real timers. */
function flush(): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, 0)
  })
}

/* -------------------------------------------------------------------------- */
/* Happy path                                                                  */
/* -------------------------------------------------------------------------- */

describe('mounting', () => {
  it('moves from pending to mounted and publishes every step', async () => {
    // Arrange
    const attach = vi.fn(async () => undefined)
    const { controller } = createController(operations({ attach }))
    const seen: string[] = []
    controller.subscribe(() => seen.push(controller.getState().status))
    expect(controller.state).toEqual({ status: 'pending', attempt: 0 })

    // Act
    await controller.start()

    // Assert
    expect(controller.state).toEqual({ status: 'mounted' })
    expect(controller.getState()).toEqual({ status: 'mounted' })
    expect(controller.isDisposed).toBe(false)
    expect(seen).toEqual(['pending', 'mounted'])
    expect(attach).toHaveBeenCalledTimes(1)
    expect(attach).toHaveBeenCalledWith(MODULE, expect.any(AbortSignal))
  })

  it('does not start until it is asked to', () => {
    const load = vi.fn(async () => MODULE)
    createController(operations({ load }))

    expect(load).not.toHaveBeenCalled()
  })

  it('keeps notifying the remaining subscribers when one of them throws', async () => {
    const healthy = vi.fn()
    const { controller, records } = createController(operations())
    controller.subscribe(() => {
      throw new Error('subscriber blew up')
    })
    controller.subscribe(healthy)

    await controller.start()

    expect(healthy).toHaveBeenCalled()
    expect(records.some(record => record.error.message.includes('subscriber blew up'))).toBe(true)
  })
})

/* -------------------------------------------------------------------------- */
/* Failure and retry                                                           */
/* -------------------------------------------------------------------------- */

describe('failure and retry', () => {
  it('settles a load failure into a structured error and reports it', async () => {
    // Arrange
    const detach = vi.fn()
    const { controller, records } = createController(
      operations({
        load: async () => {
          throw new Error('manifest returned 404')
        },
        detach,
      }),
    )

    // Act
    await controller.start()

    // Assert
    const failure = errorStateOf(controller.state)
    expect(failure.code).toBe('mount/failure')
    expect(failure.message).toContain('reports@2.1.0')
    expect(failure.message).toContain('manifest returned 404')
    expect(failure.message).toContain('explicit retry action')
    expect(detach).toHaveBeenCalledTimes(1)
    expect(records).toHaveLength(1)
  })

  it('starts a fresh attempt on retry', async () => {
    let attempt = 0
    const load = vi.fn(async () => {
      attempt += 1
      if (attempt === 1) throw new Error('remote unreachable')
      return MODULE
    })
    const { controller } = createController(operations({ load }))
    await controller.start()
    expect(controller.state.status).toBe('error')

    controller.retry()

    expect(controller.state).toEqual({ status: 'pending', attempt: 2 })
    await vi.waitFor(() => expect(controller.state).toEqual({ status: 'mounted' }))
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('reuses the already-loaded module when retrying after a mount failure', async () => {
    // Arrange: the code downloaded fine; only rendering it failed.
    const load = vi.fn(async () => MODULE)
    let attaches = 0
    const attach = vi.fn(async () => {
      attaches += 1
      if (attaches === 1) throw new Error('render threw')
    })
    const { controller } = createController(operations({ load, attach }))
    await controller.start()
    expect(controller.state.status).toBe('error')

    // Act
    controller.retry()
    await vi.waitFor(() => expect(controller.state).toEqual({ status: 'mounted' }))

    // Assert: a perfectly good download is not thrown away to re-run a render.
    expect(load).toHaveBeenCalledTimes(1)
    expect(attach).toHaveBeenCalledTimes(2)
  })

  it('reloads when the previous attempt never got as far as a module', async () => {
    let attempt = 0
    const load = vi.fn(async () => {
      attempt += 1
      if (attempt === 1) throw new Error('remote unreachable')
      return MODULE
    })
    const attach = vi.fn(async () => undefined)
    const { controller } = createController(operations({ load, attach }))
    await controller.start()

    controller.retry()
    await vi.waitFor(() => expect(controller.state).toEqual({ status: 'mounted' }))

    expect(load).toHaveBeenCalledTimes(2)
    expect(attach).toHaveBeenCalledTimes(1)
  })

  it('structures a non-Error thrown by the adapter', async () => {
    const { controller } = createController(
      operations({
        attach: async () => {
          throw 'attach said no'
        },
      }),
    )

    await controller.start()

    const failure = errorStateOf(controller.state)
    expect(failure.message).toContain('attach said no')
  })
})

/* -------------------------------------------------------------------------- */
/* Attempt fencing                                                             */
/* -------------------------------------------------------------------------- */

describe('attempt fencing', () => {
  it('does not let a superseded attempt settle over the newer one', async () => {
    // Arrange: the first load is still in flight when a retry starts.
    const pending: Deferred<TestModule>[] = []
    const load = vi.fn(() => {
      const next = deferred<TestModule>()
      pending.push(next)
      return next.promise
    })
    const attached: TestModule[] = []
    const attach = vi.fn(async (loaded: TestModule) => {
      attached.push(loaded)
    })
    const { controller } = createController(operations({ load, attach }))

    void controller.start()
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1))
    controller.retry()
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2))

    // Act: the newer attempt wins, and only then does the stale one resolve.
    pending[1]?.resolve(SECOND_MODULE)
    await vi.waitFor(() => expect(controller.state).toEqual({ status: 'mounted' }))
    pending[0]?.resolve(MODULE)
    await flush()

    // Assert
    expect(attached).toEqual([SECOND_MODULE])
    expect(controller.state).toEqual({ status: 'mounted' })
  })

  it('detaches whatever a superseded attempt had already attached', async () => {
    // Arrange
    const attaches: Deferred<void>[] = []
    const attach = vi.fn(() => {
      const next = deferred<void>()
      attaches.push(next)
      return next.promise
    })
    const detach = vi.fn()
    const { controller } = createController(operations({ attach, detach }))

    void controller.start()
    await vi.waitFor(() => expect(attach).toHaveBeenCalledTimes(1))
    controller.retry()
    await vi.waitFor(() => expect(attach).toHaveBeenCalledTimes(2))
    attaches[1]?.resolve()
    await vi.waitFor(() => expect(controller.state).toEqual({ status: 'mounted' }))
    detach.mockClear()

    // Act: the stale attempt finishes attaching after losing the race.
    attaches[0]?.resolve()
    await flush()

    // Assert: it does not get to leave a tree behind.
    expect(detach).toHaveBeenCalledTimes(1)
    expect(controller.state).toEqual({ status: 'mounted' })
  })
})

/* -------------------------------------------------------------------------- */
/* Deadlines                                                                   */
/* -------------------------------------------------------------------------- */

describe('deadlines', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fails a load that never settles, aborting its work and detaching', async () => {
    // Arrange
    let loadSignal: AbortSignal | undefined
    const detach = vi.fn()
    const { controller, records } = createController(
      operations({
        load: signal => {
          loadSignal = signal
          return new Promise<TestModule>(() => undefined)
        },
        detach,
      }),
    )

    // Act
    const started = controller.start()
    await vi.advanceTimersByTimeAsync(30_000)
    await started

    // Assert
    const failure = errorStateOf(controller.state)
    expect(failure.code).toBe('load/timeout')
    expect(failure.message).toContain('within 30000ms')
    expect(loadSignal?.aborted).toBe(true)
    expect(isMfeError(loadSignal?.reason)).toBe(true)
    expect(detach).toHaveBeenCalledTimes(1)
    expect(records).toHaveLength(1)
    expect(records[0]?.error.code).toBe('load/timeout')
  })

  it('fails a mount that never settles, aborting its work and detaching', async () => {
    // Arrange
    let attachSignal: AbortSignal | undefined
    const detach = vi.fn()
    const { controller, records } = createController(
      operations({
        attach: (_loaded, signal) => {
          attachSignal = signal
          return new Promise<void>(() => undefined)
        },
        detach,
      }),
    )

    // Act
    const started = controller.start()
    await vi.advanceTimersByTimeAsync(30_000)
    await started

    // Assert
    const failure = errorStateOf(controller.state)
    expect(failure.code).toBe('mount/timeout')
    expect(attachSignal?.aborted).toBe(true)
    expect(detach).toHaveBeenCalledTimes(1)
    expect(records[0]?.error.code).toBe('mount/timeout')
  })

  it('measures the mount deadline after the code is ready rather than sharing one clock', async () => {
    // Arrange: each phase takes two thirds of its own deadline, so a single
    // shared clock would have expired.
    const { controller } = createController(
      operations({
        load: () =>
          new Promise<TestModule>(resolve => {
            setTimeout(() => resolve(MODULE), 20_000)
          }),
        attach: () =>
          new Promise<void>(resolve => {
            setTimeout(resolve, 20_000)
          }),
      }),
    )

    // Act
    const started = controller.start()
    await vi.advanceTimersByTimeAsync(40_000)
    await started

    // Assert
    expect(controller.state).toEqual({ status: 'mounted' })
  })

  it('rejects disposal that outruns the cleanup deadline while staying disposed', async () => {
    // Arrange
    const { controller, records } = createController(
      operations({ cleanup: () => new Promise<void>(() => undefined) }),
    )
    await controller.start()

    // Act
    const disposal = controller.dispose()
    const assertion = expect(disposal).rejects.toMatchObject({ code: 'dispose/timeout' })
    await vi.advanceTimersByTimeAsync(5_000)
    await assertion

    // Assert: the mount is terminal regardless, so late callbacks stay fenced.
    expect(controller.state).toEqual({ status: 'disposed' })
    expect(controller.isDisposed).toBe(true)
    expect(controller.signal.aborted).toBe(true)
    expect(records.some(record => record.error.code === 'dispose/timeout')).toBe(true)
  })
})

/* -------------------------------------------------------------------------- */
/* Disposal                                                                    */
/* -------------------------------------------------------------------------- */

describe('disposal', () => {
  it('detaches synchronously before awaiting cleanup', async () => {
    // Arrange
    const order: string[] = []
    const { controller } = createController(
      operations({
        detach: () => {
          order.push('detach')
        },
        cleanup: async () => {
          order.push('cleanup-started')
          await Promise.resolve()
          order.push('cleanup-finished')
        },
      }),
    )
    await controller.start()

    // Act
    const disposal = controller.dispose()

    // Assert: the failed or disposed surface is already gone, and the mount is
    // already terminal, before anything is awaited.
    expect(order).toEqual(['detach', 'cleanup-started'])
    expect(controller.state).toEqual({ status: 'disposed' })

    await disposal
    expect(order).toEqual(['detach', 'cleanup-started', 'cleanup-finished'])
  })

  it('runs cleanup once however many callers dispose it', async () => {
    const cleanup = vi.fn(async () => undefined)
    const detach = vi.fn()
    const { controller } = createController(operations({ cleanup, detach }))
    await controller.start()

    await Promise.all([controller.dispose(), controller.dispose(), controller.dispose()])

    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(detach).toHaveBeenCalledTimes(1)
    expect(controller.state).toEqual({ status: 'disposed' })
  })

  it('aborts the mount signal so author work is cancelled', async () => {
    const { controller } = createController(operations())
    await controller.start()
    expect(controller.signal.aborted).toBe(false)

    await controller.dispose()

    expect(controller.signal.aborted).toBe(true)
    expect(controller.isDisposed).toBe(true)
  })

  it('notifies the host once the mount reached its terminal state', async () => {
    const onDisposed = vi.fn()
    const { controller } = createController(operations(), { onDisposed })
    await controller.start()

    await controller.dispose()

    expect(onDisposed).toHaveBeenCalledTimes(1)
  })

  it('runs the remaining cleanup even when detach throws', async () => {
    // Arrange
    const cleanup = vi.fn(async () => undefined)
    const { controller, records } = createController(
      operations({
        detach: () => {
          throw new Error('root was already unmounted')
        },
        cleanup,
      }),
    )
    await controller.start()

    // Act
    await controller.dispose()

    // Assert
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(controller.state).toEqual({ status: 'disposed' })
    expect(records.some(record => record.error.message.includes('root was already unmounted'))).toBe(
      true,
    )
  })

  it('reports a cleanup failure as a structured disposal error', async () => {
    const { controller, records } = createController(
      operations({
        cleanup: async () => {
          throw new Error('subscription would not close')
        },
      }),
    )
    await controller.start()

    await expect(controller.dispose()).rejects.toMatchObject({ code: 'dispose/failure' })
    expect(controller.state).toEqual({ status: 'disposed' })
    expect(records.some(record => record.error.code === 'dispose/failure')).toBe(true)
  })

  it('refuses to retry a disposed mount', async () => {
    const load = vi.fn(async () => MODULE)
    const { controller } = createController(operations({ load }))
    await controller.start()
    await controller.dispose()
    load.mockClear()

    controller.retry()

    expect(controller.state).toEqual({ status: 'disposed' })
    expect(load).not.toHaveBeenCalled()
  })

  it('reports an attempt to start a disposed mount rather than resurrecting it', async () => {
    const { controller, records } = createController(operations())
    await controller.start()
    await controller.dispose()
    records.length = 0

    await controller.start()

    expect(controller.state).toEqual({ status: 'disposed' })
    expect(records).toHaveLength(1)
    expect(records[0]?.error.message).toContain('Disposal is terminal')
  })

  it('disposes a mount that never started', async () => {
    const detach = vi.fn()
    const cleanup = vi.fn(async () => undefined)
    const { controller } = createController(operations({ detach, cleanup }))

    await controller.dispose()

    expect(controller.state).toEqual({ status: 'disposed' })
    expect(detach).toHaveBeenCalledTimes(1)
    expect(cleanup).toHaveBeenCalledTimes(1)
  })
})
