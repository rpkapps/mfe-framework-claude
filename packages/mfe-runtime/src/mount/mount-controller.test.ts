import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  isMfeError,
  type DeadlineConfig,
  type Diagnostic,
  type MountState,
} from '@company/mfe-core'

import { MountController, type MountOperations } from './mount-controller.ts'
import {
  at,
  codesOf,
  deferred,
  flush,
  recordingDiagnostics,
  type Deferred,
} from '../__tests__/harness.ts'

interface TestModule {
  readonly name: string
}

const MODULE: TestModule = { name: 'reports' }
const SECOND_MODULE: TestModule = { name: 'reports-retry' }

const DEADLINES: DeadlineConfig = Object.freeze({ load: 30_000, mount: 30_000, dispose: 5_000 })

function operations(
  overrides: Partial<MountOperations<TestModule>> = {},
): MountOperations<TestModule> {
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

describe('mounting', () => {
  it('moves from pending to mounted and publishes every step', async () => {
    const attach = vi.fn(async () => undefined)
    const { controller } = createController(operations({ attach }))
    const seen: string[] = []
    controller.subscribe(() => seen.push(controller.getState().status))
    expect(controller.state).toEqual({ status: 'pending', attempt: 0 })

    await controller.start()

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

describe('failure and retry', () => {
  it('settles a load failure into a structured error and reports it', async () => {
    const detach = vi.fn()
    const { controller, records } = createController(
      operations({
        load: async () => {
          throw new Error('manifest returned 404')
        },
        detach,
      }),
    )

    await controller.start()

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
    // the code downloaded fine; only rendering it failed.
    const load = vi.fn(async () => MODULE)
    let attaches = 0
    const attach = vi.fn(async () => {
      attaches += 1
      if (attaches === 1) throw new Error('render threw')
    })
    const { controller } = createController(operations({ load, attach }))
    await controller.start()
    expect(controller.state.status).toBe('error')

    controller.retry()
    await vi.waitFor(() => expect(controller.state).toEqual({ status: 'mounted' }))

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
          // eslint-disable-next-line @typescript-eslint/only-throw-error -- an adapter that throws a non-Error is exactly what this test covers, so the value has to stay a bare string
          throw 'attach said no'
        },
      }),
    )

    await controller.start()

    const failure = errorStateOf(controller.state)
    expect(failure.message).toContain('attach said no')
  })
})

describe('retry', () => {
  it('ignores a retry while the first attempt is still in flight', async () => {
    const load = deferred<TestModule>()
    const loadCalls = vi.fn(() => load.promise)
    const { controller } = createController(operations({ load: loadCalls }))

    void controller.start()
    controller.retry()
    load.resolve(MODULE)
    await vi.waitFor(() => expect(controller.state).toEqual({ status: 'mounted' }))

    expect(loadCalls).toHaveBeenCalledTimes(1)
  })

  it('ignores a retry once mounted, so a second UI is never attached beside the first', async () => {
    const attach = vi.fn(async () => undefined)
    const { controller } = createController(operations({ attach }))
    await controller.start()

    controller.retry()
    await flush()

    expect(attach).toHaveBeenCalledTimes(1)
    expect(controller.state).toEqual({ status: 'mounted' })
  })
})

describe('releasing a failed attempt', () => {
  it('cleans up a failed attach as well as detaching it', async () => {
    const detach = vi.fn()
    const cleanup = vi.fn(async () => undefined)
    const { controller, records } = createController(
      operations({
        attach: async () => {
          throw new Error('render threw')
        },
        detach,
        cleanup,
      }),
    )

    await controller.start()

    expect(controller.state.status).toBe('error')
    expect(detach).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledTimes(1))
    expect(records).toHaveLength(1)
  })

  it('reports a failed attempt before its cleanup has finished', async () => {
    const cleanup = deferred<void>()
    const { controller, records } = createController(
      operations({
        attach: async () => {
          throw new Error('render threw')
        },
        cleanup: () => cleanup.promise,
      }),
    )

    await controller.start()

    expect(controller.state.status).toBe('error')
    expect(records).toHaveLength(1)
    cleanup.resolve()
  })

  it('reports a cleanup that failed after a failed attempt, once', async () => {
    const { controller, records } = createController(
      operations({
        attach: async () => {
          throw new Error('render threw')
        },
        cleanup: async () => {
          throw new Error('root would not unmount')
        },
      }),
    )

    await controller.start()
    await flush()

    expect(codesOf(records)).toEqual(['mount/failure', 'dispose/failure'])
    expect(at(records, 1).error.message).toContain('root would not unmount')
  })

  it('detaches and cleans up what an attach disposed mid-way had attached once it settles', async () => {
    const attach = deferred<void>()
    const detach = vi.fn()
    const cleanup = vi.fn(async () => undefined)
    const { controller } = createController(
      operations({ attach: () => attach.promise, detach, cleanup }),
    )
    const started = controller.start()
    await vi.waitFor(() => expect(controller.state).toEqual({ status: 'pending', attempt: 1 }))
    await flush()

    await controller.dispose()
    expect(detach).toHaveBeenCalledTimes(1)
    expect(cleanup).toHaveBeenCalledTimes(1)

    // The attach finishes after losing the race, having rendered something.
    attach.resolve()
    await started
    await flush()

    expect(detach).toHaveBeenCalledTimes(2)
    expect(cleanup).toHaveBeenCalledTimes(2)
    expect(controller.state).toEqual({ status: 'disposed' })
  })
})

describe('failing a mounted definition', () => {
  it('moves a mounted mount to error, releasing what it attached, and reports it once', async () => {
    const detach = vi.fn()
    const cleanup = vi.fn(async () => undefined)
    const { controller, records } = createController(operations({ detach, cleanup }))
    await controller.start()

    controller.fail(new Error('root unmounted itself'))

    const failure = errorStateOf(controller.state)
    expect(failure.code).toBe('mount/failure')
    expect(failure.message).toContain('reports@2.1.0 failed to keep the mounted definition running')
    expect(failure.message).toContain('root unmounted itself')
    expect(detach).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledTimes(1))
    expect(records).toHaveLength(1)
  })

  it('mounts again on retry without reloading the code', async () => {
    const load = vi.fn(async () => MODULE)
    const attach = vi.fn(async () => undefined)
    const { controller } = createController(operations({ load, attach }))
    await controller.start()
    controller.fail(new Error('root unmounted itself'))

    controller.retry()

    expect(controller.state).toEqual({ status: 'pending', attempt: 2 })
    await vi.waitFor(() => expect(controller.state).toEqual({ status: 'mounted' }))
    expect(load).toHaveBeenCalledTimes(1)
    expect(attach).toHaveBeenCalledTimes(2)
  })

  it('fails an attempt still attaching once its attach settles, instead of mounting it', async () => {
    const attach = deferred<void>()
    const detach = vi.fn()
    const { controller, records } = createController(
      operations({ attach: () => attach.promise, detach }),
    )
    const started = controller.start()
    await vi.waitFor(() => expect(controller.state).toEqual({ status: 'pending', attempt: 1 }))

    controller.fail(new Error('root unmounted itself'))
    controller.fail(new Error('and again'))
    expect(controller.state).toEqual({ status: 'pending', attempt: 1 })
    attach.resolve()
    await started

    expect(errorStateOf(controller.state).message).toContain('root unmounted itself')
    expect(detach).toHaveBeenCalledTimes(1)
    expect(records).toHaveLength(1)
  })

  it('is ignored before any attempt, once failed and once disposed', async () => {
    const { controller, records } = createController(operations())

    controller.fail(new Error('before any attempt'))
    await controller.start()
    controller.fail(new Error('first'))
    controller.fail(new Error('second'))
    await controller.dispose()
    controller.fail(new Error('after disposal'))

    expect(codesOf(records)).toEqual(['mount/failure'])
    expect(at(records).error.message).toContain('first')
    expect(controller.state).toEqual({ status: 'disposed' })
  })
})

describe('deadlines', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fails a load that never settles, aborting its work and detaching', async () => {
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

    const started = controller.start()
    await vi.advanceTimersByTimeAsync(30_000)
    await started

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

    const started = controller.start()
    await vi.advanceTimersByTimeAsync(30_000)
    await started

    const failure = errorStateOf(controller.state)
    expect(failure.code).toBe('mount/timeout')
    expect(attachSignal?.aborted).toBe(true)
    expect(detach).toHaveBeenCalledTimes(1)
    expect(records[0]?.error.code).toBe('mount/timeout')
  })

  it('never lets an attempt that timed out settle over the retry that followed it', async () => {
    const loads: Deferred<TestModule>[] = []
    const load = vi.fn(() => {
      const next = deferred<TestModule>()
      loads.push(next)
      return next.promise
    })
    const attached: TestModule[] = []
    const attach = vi.fn(async (loaded: TestModule) => {
      attached.push(loaded)
    })
    const { controller } = createController(operations({ load, attach }))

    const started = controller.start()
    await vi.advanceTimersByTimeAsync(30_000)
    await started
    expect(controller.state.status).toBe('error')

    controller.retry()
    at(loads, 1).resolve(SECOND_MODULE)
    await vi.waitFor(() => expect(controller.state).toEqual({ status: 'mounted' }))
    at(loads, 0).resolve(MODULE)
    await vi.advanceTimersByTimeAsync(0)

    expect(attached).toEqual([SECOND_MODULE])
    expect(controller.state).toEqual({ status: 'mounted' })
  })

  it('measures the mount deadline after the code is ready rather than sharing one clock', async () => {
    // each phase takes two thirds of its own deadline, so a single shared clock would
    // have expired.
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

    const started = controller.start()
    await vi.advanceTimersByTimeAsync(40_000)
    await started

    expect(controller.state).toEqual({ status: 'mounted' })
  })

  it('rejects disposal that outruns the cleanup deadline while staying disposed', async () => {
    const { controller, records } = createController(
      operations({ cleanup: () => new Promise<void>(() => undefined) }),
    )
    await controller.start()

    const disposal = controller.dispose()
    const assertion = expect(disposal).rejects.toMatchObject({ code: 'dispose/timeout' })
    await vi.advanceTimersByTimeAsync(5_000)
    await assertion

    expect(controller.state).toEqual({ status: 'disposed' })
    expect(controller.isDisposed).toBe(true)
    expect(controller.signal.aborted).toBe(true)
    expect(records.some(record => record.error.code === 'dispose/timeout')).toBe(true)
  })
})

describe('disposal', () => {
  it('detaches synchronously before awaiting cleanup', async () => {
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

    const disposal = controller.dispose()

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

    await controller.dispose()

    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(controller.state).toEqual({ status: 'disposed' })
    expect(
      records.some(record => record.error.message.includes('root was already unmounted')),
    ).toBe(true)
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
    expect(records[0]?.error.message).toContain('disposal is terminal')
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
