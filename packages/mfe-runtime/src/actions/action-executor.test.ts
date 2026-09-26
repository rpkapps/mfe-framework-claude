import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import {
  allow,
  deny,
  type ActionExecutionContext,
  type ActionRegistration,
} from '@company/mfe-core'

import { ActionRegistry, type ActionRegistryOptions } from './action-registry.ts'
import type { ActionAuditSink } from './action-audit.ts'
import {
  DEFAULT_ACTION_TIMEOUT_MS,
  type ActionExecutionResult,
  type ApprovalRequest,
  type ApprovalRuling,
} from './action-executor.ts'
import { codesOf, recordingDiagnostics } from '../__tests__/harness.ts'

const owner = {
  definitionId: 'orders',
  mountToken: 'mount-1',
  kind: 'app',
  basePath: '/orders',
} as const

const refundInput = z.object({ orderId: z.string(), amount: z.number().positive() })

function setup(options: ActionRegistryOptions = {}) {
  const { hub, records } = recordingDiagnostics()
  const registry = new ActionRegistry({ diagnostics: hub, ...options })
  return {
    registry,
    records,
    register: (registration: Partial<ActionRegistration>) =>
      registry.register(owner, {
        name: 'refund',
        label: 'Refund an order',
        execute: () => undefined,
        ...registration,
      }),
  }
}

/** A promise the test settles, for a step that must wait on something. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>(settle => {
    resolve = settle
  })
  return { promise, resolve }
}

describe('input', () => {
  it('runs the action with the input its schema parsed', async () => {
    const { register, registry } = setup()
    const execute = vi.fn()
    register({
      inputSchema: z.object({ orderId: z.string(), notify: z.boolean().default(true) }),
      execute,
    })

    const result = await registry.execute('orders:refund', {
      caller: 'palette',
      input: { orderId: 'A-1' },
    })

    expect(result).toEqual({ status: 'executed', value: undefined })
    expect(execute).toHaveBeenCalledWith(
      { orderId: 'A-1', notify: true },
      { signal: expect.any(AbortSignal) as unknown },
    )
  })

  it('refuses input the schema rejects, without running the action', async () => {
    const { register, registry, records } = setup()
    const execute = vi.fn()
    register({ inputSchema: refundInput, execute })

    const result = await registry.execute('orders:refund', {
      caller: 'agent',
      input: { orderId: 'A-1', amount: -5 },
    })

    expect(result.status).toBe('invalid')
    expect(result.status === 'invalid' && result.error.path).toEqual(['amount'])
    expect(execute).not.toHaveBeenCalled()
    expect(codesOf(records)).toEqual(['contract/input-mismatch'])
  })

  it('gives an action without a schema an empty object, whatever the caller sent', async () => {
    const { register, registry } = setup()
    const execute = vi.fn()
    register({ execute })

    await registry.execute('orders:refund', { caller: 'palette', input: { stray: 1 } })

    expect(execute).toHaveBeenCalledWith({}, { signal: expect.any(AbortSignal) as unknown })
  })
})

describe('output', () => {
  it('returns what the outputSchema parsed', async () => {
    const { register, registry } = setup()
    register({
      outputSchema: z.object({ refunded: z.number() }),
      execute: () => ({ refunded: 5, internal: 'dropped' }),
    })

    await expect(registry.execute('orders:refund', { caller: 'ui' })).resolves.toEqual({
      status: 'executed',
      value: { refunded: 5 },
    })
  })

  it('fails a run whose value does not match its outputSchema', async () => {
    const { register, registry, records } = setup()
    register({ outputSchema: z.object({ refunded: z.number() }), execute: () => ({}) })

    const result = await registry.execute('orders:refund', { caller: 'ui' })

    expect(result.status).toBe('failed')
    expect(codesOf(records)).toEqual(['contract/output-mismatch'])
  })
})

describe('the agent placement', () => {
  it('refuses an agent call to an action not offered to the agent', async () => {
    const { register, registry } = setup()
    const execute = vi.fn()
    register({ effect: 'read', placements: ['palette'], execute })

    await expect(registry.execute('orders:refund', { caller: 'agent' })).resolves.toEqual({
      status: 'denied',
      reason: 'This action is not offered to the agent.',
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it('still runs that action for a user, from its own UI', async () => {
    const { register, registry } = setup()
    const execute = vi.fn()
    register({ placements: [], execute })

    await registry.execute('orders:refund', { caller: 'ui' })

    expect(execute).toHaveBeenCalledOnce()
  })
})

describe('approval', () => {
  it('runs an agent read without asking', async () => {
    const approver = vi.fn(async () => await Promise.resolve(true))
    const { register, registry } = setup()
    registry.setApprover(approver)
    const execute = vi.fn()
    register({ effect: 'read', execute })

    await registry.execute('orders:refund', { caller: 'agent' })

    expect(execute).toHaveBeenCalledOnce()
    expect(approver).not.toHaveBeenCalled()
  })

  it('asks before an agent write, undeclared or not, and runs it once approved', async () => {
    const requests: ApprovalRequest[] = []
    const { register, registry } = setup()
    registry.setApprover(async request => {
      requests.push(request)
      return await Promise.resolve(true)
    })
    const execute = vi.fn()
    register({ description: 'Refunds part of an order.', inputSchema: refundInput, execute })

    const result = await registry.execute('orders:refund', {
      caller: 'agent',
      input: { orderId: 'A-1', amount: 5 },
    })

    expect(result).toEqual({ status: 'executed', value: undefined })
    expect(requests).toEqual([
      {
        actionId: 'orders:refund',
        definitionId: 'orders',
        label: 'Refund an order',
        description: 'Refunds part of an order.',
        effect: 'write',
        input: { orderId: 'A-1', amount: 5 },
      },
    ])
  })

  it('reports a call the user declined, and does not run it', async () => {
    const { register, registry } = setup()
    registry.setApprover(async () => await Promise.resolve(false))
    const execute = vi.fn()
    register({ effect: 'destructive', execute })

    await expect(registry.execute('orders:refund', { caller: 'agent' })).resolves.toEqual({
      status: 'declined',
      reason: 'The user declined this call.',
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it('denies a call that needs approval when nothing can ask for it', async () => {
    const { register, registry } = setup()
    const execute = vi.fn()
    register({ execute })

    const result = await registry.execute('orders:refund', { caller: 'agent' })

    expect(result.status).toBe('denied')
    expect(execute).not.toHaveBeenCalled()
  })

  it('asks for the calls needsApproval picks, reading the validated input', async () => {
    const approver = vi.fn(async () => await Promise.resolve(true))
    const { registry } = setup()
    registry.setApprover(approver)
    registry.register(owner, {
      name: 'refund',
      label: 'Refund an order',
      inputSchema: refundInput,
      needsApproval: input => input.amount > 100,
      execute: () => undefined,
    })

    await registry.execute('orders:refund', { caller: 'agent', input: { orderId: 'A', amount: 5 } })
    expect(approver).not.toHaveBeenCalled()

    await registry.execute('orders:refund', {
      caller: 'agent',
      input: { orderId: 'A', amount: 500 },
    })
    expect(approver).toHaveBeenCalledOnce()
  })

  it('asks when needsApproval throws, since the call it was meant to catch may be this one', async () => {
    const approver = vi.fn(async () => await Promise.resolve(true))
    const { register, registry, records } = setup()
    registry.setApprover(approver)
    register({
      needsApproval: () => {
        throw new Error('threshold unavailable')
      },
    })

    await registry.execute('orders:refund', { caller: 'agent' })

    expect(approver).toHaveBeenCalledOnce()
    expect(codesOf(records)).toEqual(['mount/failure'])
  })

  it('never asks a user, who is the approval for their own run', async () => {
    const approver = vi.fn(async () => await Promise.resolve(false))
    const { register, registry } = setup()
    registry.setApprover(approver)
    const execute = vi.fn()
    register({ effect: 'destructive', execute })

    await registry.execute('orders:refund', { caller: 'palette' })
    await registry.execute('orders:refund', { caller: 'shortcut' })
    await registry.execute('orders:refund', { caller: 'ui' })

    expect(execute).toHaveBeenCalledTimes(3)
    expect(approver).not.toHaveBeenCalled()
  })

  it('keeps the approver it was given only until that approver is removed', async () => {
    const { register, registry } = setup()
    const first = registry.setApprover(async () => await Promise.resolve(true))
    const removeSecond = registry.setApprover(async () => await Promise.resolve(false))
    register({})

    // Removing a replaced approver leaves the current one in place.
    first()
    await expect(registry.execute('orders:refund', { caller: 'agent' })).resolves.toMatchObject({
      status: 'declined',
    })

    removeSecond()
    await expect(registry.execute('orders:refund', { caller: 'agent' })).resolves.toMatchObject({
      status: 'denied',
    })
  })
})

describe('the approval policy', () => {
  it('sees what the action declared, and may approve, deny or keep it', async () => {
    const seen: string[] = []
    const { register, registry } = setup({
      approvalPolicy: (request, declared) => {
        seen.push(`${request.actionId}:${declared}`)
        if (request.input['amount'] === 1) return 'approve'
        if (request.input['amount'] === 2) return { deny: 'Refunds of 2 are never automated.' }
        return undefined
      },
    })
    const execute = vi.fn()
    register({ inputSchema: refundInput, execute })

    await expect(
      registry.execute('orders:refund', { caller: 'agent', input: { orderId: 'A', amount: 1 } }),
    ).resolves.toMatchObject({ status: 'executed' })
    await expect(
      registry.execute('orders:refund', { caller: 'agent', input: { orderId: 'A', amount: 2 } }),
    ).resolves.toEqual({ status: 'denied', reason: 'Refunds of 2 are never automated.' })
    // Kept: a write asks, and nothing here can ask.
    await expect(
      registry.execute('orders:refund', { caller: 'agent', input: { orderId: 'A', amount: 3 } }),
    ).resolves.toMatchObject({ status: 'denied' })

    expect(execute).toHaveBeenCalledOnce()
    expect(seen).toEqual(['orders:refund:ask', 'orders:refund:ask', 'orders:refund:ask'])
  })

  it('can make a declared read ask', async () => {
    const approver = vi.fn(async () => await Promise.resolve(true))
    const { register, registry } = setup({ approvalPolicy: () => 'ask' })
    registry.setApprover(approver)
    register({ effect: 'read' })

    await registry.execute('orders:refund', { caller: 'agent' })

    expect(approver).toHaveBeenCalledOnce()
  })
})

describe('waiting', () => {
  it('runs an agent’s writes one at a time, in the order they were asked for', async () => {
    const { registry } = setup()
    const order: string[] = []
    const first = deferred<void>()
    const make = (name: string, wait?: Promise<void>) =>
      registry.register(owner, {
        name,
        label: name,
        needsApproval: false,
        execute: async () => {
          order.push(`start ${name}`)
          await wait
          order.push(`end ${name}`)
        },
      })
    make('first', first.promise)
    make('second')

    const running = [
      registry.execute('orders:first', { caller: 'agent' }),
      registry.execute('orders:second', { caller: 'agent' }),
    ]
    await Promise.resolve()
    await Promise.resolve()
    expect(order).toEqual(['start first'])

    first.resolve()
    await Promise.all(running)
    expect(order).toEqual(['start first', 'end first', 'start second', 'end second'])
  })

  it('lets reads and parallel-safe writes run beside a write that is still running', async () => {
    const { registry } = setup()
    const order: string[] = []
    const slow = deferred<void>()
    registry.register(owner, {
      name: 'slow',
      label: 'Slow',
      needsApproval: false,
      execute: async () => {
        await slow.promise
        order.push('slow')
      },
    })
    registry.register(owner, {
      name: 'read',
      label: 'Read',
      effect: 'read',
      execute: () => order.push('read'),
    })
    registry.register(owner, {
      name: 'safe',
      label: 'Safe',
      needsApproval: false,
      parallelSafe: true,
      execute: () => order.push('safe'),
    })

    const slowRun = registry.execute('orders:slow', { caller: 'agent' })
    await registry.execute('orders:read', { caller: 'agent' })
    await registry.execute('orders:safe', { caller: 'agent' })
    expect(order).toEqual(['read', 'safe'])

    slow.resolve()
    await slowRun
    expect(order).toEqual(['read', 'safe', 'slow'])
  })

  it('does not stop the queue when a write fails', async () => {
    const { registry } = setup()
    registry.register(owner, {
      name: 'broken',
      label: 'Broken',
      needsApproval: false,
      execute: () => {
        throw new Error('down')
      },
    })
    const execute = vi.fn()
    registry.register(owner, { name: 'next', label: 'Next', needsApproval: false, execute })

    const results = await Promise.all([
      registry.execute('orders:broken', { caller: 'agent' }),
      registry.execute('orders:next', { caller: 'agent' }),
    ])

    expect(results.map(result => result.status)).toEqual(['failed', 'executed'])
  })

  it('does not run a call whose mount went away while the user was asked', async () => {
    const { register, registry } = setup()
    const answer = deferred<boolean>()
    registry.setApprover(async () => await answer.promise)
    const execute = vi.fn()
    register({ execute })

    const running = registry.execute('orders:refund', { caller: 'agent' })
    registry.removeMount('mount-1')
    answer.resolve(true)

    await expect(running).resolves.toMatchObject({
      status: 'unavailable',
      error: { code: 'action/unavailable' },
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it('decides again after the user approved, since the page may have changed', async () => {
    const { register, registry } = setup()
    const answer = deferred<boolean>()
    registry.setApprover(async () => await answer.promise)
    let open = true
    const execute = vi.fn()
    register({ canExecute: () => (open ? allow() : deny('The order was closed.')), execute })

    const running = registry.execute('orders:refund', { caller: 'agent' })
    open = false
    answer.resolve(true)

    await expect(running).resolves.toEqual({ status: 'denied', reason: 'The order was closed.' })
    expect(execute).not.toHaveBeenCalled()
  })

  it('refuses a call that waited if the action stopped being offered to the agent', async () => {
    const { register, registry } = setup()
    const answer = deferred<boolean>()
    registry.setApprover(async () => await answer.promise)
    const execute = vi.fn()
    const handle = register({ execute })

    const running = registry.execute('orders:refund', { caller: 'agent' })
    handle.update({ name: 'refund', label: 'Refund an order', placements: ['palette'], execute })
    answer.resolve(true)

    await expect(running).resolves.toEqual({
      status: 'denied',
      reason: 'This action is not offered to the agent.',
    })
    expect(execute).not.toHaveBeenCalled()
  })
})

/** An `execute` that never settles, as an App's forgotten promise does, keeping each signal. */
function hanging() {
  const signals: AbortSignal[] = []
  const execute = vi.fn((_input: unknown, { signal }: ActionExecutionContext) => {
    signals.push(signal)
    return new Promise<never>(() => undefined)
  })
  return { execute, signals }
}

describe('the deadline', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('fails a write that never settles, and runs the next one', async () => {
    const audit = vi.fn<ActionAuditSink>()
    const { registry, records } = setup({ audit })
    const hung = hanging()
    registry.register(owner, { name: 'save', label: 'Save', needsApproval: false, ...hung })
    const next = vi.fn(() => 'saved')
    registry.register(owner, { name: 'next', label: 'Next', needsApproval: false, execute: next })

    const first = registry.execute('orders:save', { caller: 'agent' })
    const second = registry.execute('orders:next', { caller: 'agent' })
    await vi.advanceTimersByTimeAsync(DEFAULT_ACTION_TIMEOUT_MS - 1)
    expect(next).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    await expect(first).resolves.toMatchObject({
      status: 'failed',
      error: { code: 'action/timeout' },
    })
    await expect(second).resolves.toEqual({ status: 'executed', value: 'saved' })
    expect(hung.signals[0]?.aborted).toBe(true)
    expect(hung.signals[0]?.reason).toMatchObject({ code: 'action/timeout' })
    expect(codesOf(records)).toEqual(['action/timeout'])
    expect(audit.mock.calls.map(([record]) => [record.actionId, record.outcome])).toEqual([
      ['orders:save', 'failed'],
      ['orders:next', 'executed'],
    ])
    expect(audit.mock.calls[0]?.[0]).toMatchObject({ errorCode: 'action/timeout' })
  })

  it('drops what execute returns once its run timed out', async () => {
    const audit = vi.fn<ActionAuditSink>()
    const { register, registry, records } = setup({ audit })
    const late = deferred<unknown>()
    // A late value that fails the schema would be reported, were it still read.
    register({
      needsApproval: false,
      outputSchema: z.object({ refunded: z.number() }),
      execute: async () => await late.promise,
    })

    const running = registry.execute('orders:refund', { caller: 'agent' })
    await vi.advanceTimersByTimeAsync(DEFAULT_ACTION_TIMEOUT_MS)
    late.resolve({ refunded: 'late' })
    await vi.runAllTimersAsync()

    await expect(running).resolves.toMatchObject({ status: 'failed' })
    expect(codesOf(records)).toEqual(['action/timeout'])
    expect(audit).toHaveBeenCalledOnce()
    expect(audit.mock.calls[0]?.[0]).toMatchObject({ outcome: 'failed' })
  })

  it('does not report a throw that comes after the run timed out', async () => {
    const { register, registry, records } = setup()
    register({
      needsApproval: false,
      execute: async (_input, { signal }) =>
        await new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(new Error('aborted'))
          })
        }),
    })

    const running = registry.execute('orders:refund', { caller: 'agent' })
    await vi.advanceTimersByTimeAsync(DEFAULT_ACTION_TIMEOUT_MS)

    await expect(running).resolves.toMatchObject({ error: { code: 'action/timeout' } })
    expect(codesOf(records)).toEqual(['action/timeout'])
  })

  it('takes the action’s own timeoutMs', async () => {
    const { register, registry } = setup()
    register({ needsApproval: false, timeoutMs: 100, ...hanging() })
    const settled = vi.fn<(result: ActionExecutionResult) => void>()

    void registry.execute('orders:refund', { caller: 'agent' }).then(settled)
    await vi.advanceTimersByTimeAsync(99)
    expect(settled).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(settled.mock.calls[0]?.[0]).toMatchObject({
      status: 'failed',
      error: { code: 'action/timeout' },
    })
  })

  it('counts from when execute starts, so waiting behind another write does not use it up', async () => {
    const { registry } = setup()
    const slow = deferred<void>()
    registry.register(owner, {
      name: 'slow',
      label: 'Slow',
      needsApproval: false,
      execute: async () => await slow.promise,
    })
    const done = deferred<string>()
    registry.register(owner, {
      name: 'next',
      label: 'Next',
      needsApproval: false,
      timeoutMs: 1_000,
      execute: async () => await done.promise,
    })

    void registry.execute('orders:slow', { caller: 'agent' })
    const next = registry.execute('orders:next', { caller: 'agent' })
    await vi.advanceTimersByTimeAsync(5_000)
    slow.resolve()
    await vi.advanceTimersByTimeAsync(999)
    done.resolve('in time')

    await expect(next).resolves.toEqual({ status: 'executed', value: 'in time' })
  })

  it('gives a user’s run a signal but no deadline', async () => {
    const { register, registry } = setup()
    const hung = hanging()
    register(hung)
    const settled = vi.fn()

    void registry.execute('orders:refund', { caller: 'palette' }).then(settled)
    await vi.advanceTimersByTimeAsync(DEFAULT_ACTION_TIMEOUT_MS * 10)

    expect(settled).not.toHaveBeenCalled()
    expect(hung.signals).toHaveLength(1)
    expect(hung.signals[0]?.aborted).toBe(false)
  })

  it('refuses a timeoutMs that is not a positive number of milliseconds', () => {
    const { register } = setup()
    for (const timeoutMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 31]) {
      expect(() => register({ timeoutMs })).toThrow(
        expect.objectContaining({ code: 'action/invalid-registration' }),
      )
    }
  })
})

describe('a registration that goes away', () => {
  it('releases its queued and running writes as unavailable, and the queue moves on', async () => {
    const audit = vi.fn<ActionAuditSink>()
    const { registry } = setup({ audit })
    const hung = hanging()
    registry.register(owner, { name: 'save', label: 'Save', needsApproval: false, ...hung })
    const queued = vi.fn()
    registry.register(owner, {
      name: 'publish',
      label: 'Publish',
      needsApproval: false,
      execute: queued,
    })
    const other = vi.fn(() => 'other')
    registry.register(
      { ...owner, mountToken: 'mount-2' },
      { name: 'other', label: 'Other', needsApproval: false, execute: other },
    )

    const running = [
      registry.execute('orders:save', { caller: 'agent' }),
      registry.execute('orders:publish', { caller: 'agent' }),
      registry.execute('orders:other', { caller: 'agent' }),
    ]
    await Promise.resolve()
    expect(hung.execute).toHaveBeenCalledOnce()
    registry.removeMount('mount-1')

    const results = await Promise.all(running)
    expect(results.map(result => result.status)).toEqual(['unavailable', 'unavailable', 'executed'])
    expect(results[0]).toMatchObject({ error: { code: 'action/unavailable' } })
    expect(hung.signals[0]?.aborted).toBe(true)
    expect(queued).not.toHaveBeenCalled()
    expect(audit.mock.calls.map(([record]) => record.outcome)).toEqual([
      'unavailable',
      'unavailable',
      'executed',
    ])
  })

  it('releases a user’s run when its component removes the action', async () => {
    const { register } = setup()
    const hung = hanging()
    const handle = register(hung)

    const running = handle.execute({ caller: 'ui' })
    handle.remove()

    await expect(running).resolves.toMatchObject({ status: 'unavailable' })
    expect(hung.signals[0]?.aborted).toBe(true)
  })

  it('keeps one write at a time when a queued one is released before the running one ends', async () => {
    const { registry } = setup()
    const order: string[] = []
    const first = deferred<void>()
    registry.register(owner, {
      name: 'first',
      label: 'First',
      needsApproval: false,
      execute: async () => {
        await first.promise
        order.push('first')
      },
    })
    const released = registry.register(
      { ...owner, mountToken: 'mount-2' },
      { name: 'released', label: 'Released', needsApproval: false, execute: () => undefined },
    )
    registry.register(owner, {
      name: 'last',
      label: 'Last',
      needsApproval: false,
      execute: () => {
        order.push('last')
      },
    })

    const running = [
      registry.execute('orders:first', { caller: 'agent' }),
      released.execute({ caller: 'agent' }),
      registry.execute('orders:last', { caller: 'agent' }),
    ]
    released.remove()
    await running[1]
    await Promise.resolve()
    expect(order).toEqual([])

    first.resolve()
    await Promise.all(running)
    expect(order).toEqual(['first', 'last'])
  })
})

describe('a caller that stops waiting', () => {
  it('cancels the running write and the one queued behind it, and aborts the action’s signal', async () => {
    const audit = vi.fn<ActionAuditSink>()
    const { registry } = setup({ audit })
    const hung = hanging()
    registry.register(owner, { name: 'save', label: 'Save', needsApproval: false, ...hung })
    const queued = vi.fn()
    registry.register(owner, {
      name: 'publish',
      label: 'Publish',
      needsApproval: false,
      execute: queued,
    })
    const later = vi.fn(() => 'later')
    registry.register(owner, {
      name: 'later',
      label: 'Later',
      needsApproval: false,
      execute: later,
    })
    const stop = new AbortController()

    const running = [
      registry.execute('orders:save', { caller: 'agent', signal: stop.signal }),
      registry.execute('orders:publish', { caller: 'agent', signal: stop.signal }),
    ]
    await Promise.resolve()
    stop.abort('stopped')

    await expect(Promise.all(running)).resolves.toEqual([
      { status: 'cancelled', reason: 'The caller stopped the run.' },
      { status: 'cancelled', reason: 'The caller stopped the run.' },
    ])
    expect(hung.signals[0]?.reason).toBe('stopped')
    expect(queued).not.toHaveBeenCalled()
    await expect(registry.execute('orders:later', { caller: 'agent' })).resolves.toEqual({
      status: 'executed',
      value: 'later',
    })
    expect(audit.mock.calls.map(([record]) => record.outcome)).toEqual([
      'cancelled',
      'cancelled',
      'executed',
    ])
  })

  it('runs nothing for a call whose signal already aborted', async () => {
    const { register, registry } = setup()
    const execute = vi.fn()
    register({ needsApproval: false, execute })

    await expect(
      registry.execute('orders:refund', { caller: 'agent', signal: AbortSignal.abort() }),
    ).resolves.toMatchObject({ status: 'cancelled' })
    expect(execute).not.toHaveBeenCalled()
  })

  it('reads a stop while the user was asked as cancelled, not declined', async () => {
    const { register, registry } = setup()
    const stop = new AbortController()
    // The chat's Stop answers its open card as declined, after aborting the turn.
    registry.setApprover(
      async () =>
        await new Promise<boolean>(resolve => {
          stop.signal.addEventListener('abort', () => {
            resolve(false)
          })
        }),
    )
    const execute = vi.fn()
    register({ execute })

    const running = registry.execute('orders:refund', { caller: 'agent', signal: stop.signal })
    stop.abort()

    await expect(running).resolves.toMatchObject({ status: 'cancelled' })
    expect(execute).not.toHaveBeenCalled()
  })
})

describe('host hooks that throw', () => {
  it('denies an agent call when the approval policy throws, and reports it', async () => {
    const { register, registry, records } = setup({
      approvalPolicy: () => {
        throw new Error('policy service down')
      },
    })
    registry.setApprover(() => Promise.resolve(true))
    const execute = vi.fn()
    register({ effect: 'read', execute })

    const result = await registry.execute('orders:refund', { caller: 'agent' })

    expect(result.status).toBe('denied')
    expect(execute).not.toHaveBeenCalled()
    expect(codesOf(records)).toEqual(['mount/failure'])
  })

  it.each([
    ['false', false, 'false'],
    ["'deny'", 'deny', '"deny"'],
    ['a number', 42, '42'],
    ['an object with no reason', { deny: 42 }, 'an object with no deny reason'],
  ])(
    'denies an agent call when the approval policy returns %s, and reports it',
    async (_label, ruling, observed) => {
      const { register, registry, records } = setup({
        approvalPolicy: () => ruling as unknown as ApprovalRuling,
      })
      registry.setApprover(() => Promise.resolve(true))
      const execute = vi.fn()
      register({ effect: 'read', execute })

      const result = await registry.execute('orders:refund', { caller: 'agent' })

      expect(result).toEqual({
        status: 'denied',
        reason: 'The host’s approval policy failed, so the call was not run.',
      })
      expect(execute).not.toHaveBeenCalled()
      expect(codesOf(records)).toEqual(['mount/failure'])
      expect(records[0]?.error.message).toContain(observed)
    },
  )

  it('ends a run whose denial notifier throws in a result, and audits it', async () => {
    const audited = vi.fn()
    const { register, registry } = setup({
      notifyDenial: () => {
        throw new Error('toast failed')
      },
      audit: audited,
    })
    register({ canExecute: () => deny('Closed.') })

    await expect(registry.execute('orders:refund', { caller: 'palette' })).resolves.toMatchObject({
      status: 'failed',
      error: { code: 'mount/failure' },
    })
    expect(audited).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failed' }))
  })
})

describe('a registration’s own run', () => {
  it('runs its own mount’s action when another mount of the definition has the same name', async () => {
    const { registry } = setup()
    const first = vi.fn(() => 'first')
    const second = vi.fn(() => 'second')
    registry.register(owner, { name: 'refund', label: 'Refund', execute: first })
    const handle = registry.register(
      { ...owner, mountToken: 'mount-2' },
      { name: 'refund', label: 'Refund', execute: second },
    )

    await expect(handle.execute({ caller: 'ui' })).resolves.toEqual({
      status: 'executed',
      value: 'second',
    })
    expect(first).not.toHaveBeenCalled()
  })

  it('is unavailable once removed, or once its mount is gone', async () => {
    const { register, registry } = setup()
    const execute = vi.fn()
    const removed = register({ execute })
    removed.remove()
    const disposed = registry.register(
      { ...owner, mountToken: 'mount-2' },
      { name: 'refund', label: 'Refund', execute },
    )
    registry.removeMount('mount-2')

    await expect(removed.execute({ caller: 'ui' })).resolves.toMatchObject({
      status: 'unavailable',
    })
    await expect(disposed.execute({ caller: 'ui' })).resolves.toMatchObject({
      status: 'unavailable',
    })
    expect(execute).not.toHaveBeenCalled()
  })
})

describe('the published entry', () => {
  it('carries the description, the effect and both schemas as JSON Schema', () => {
    const { register, registry } = setup()
    register({
      description: 'Refunds part of an order.',
      effect: 'destructive',
      followUp: false,
      inputSchema: refundInput,
      outputSchema: z.object({ refunded: z.number() }),
    })

    expect(registry.getSnapshot()[0]).toMatchObject({
      description: 'Refunds part of an order.',
      effect: 'destructive',
      followUp: false,
      inputSchema: {
        type: 'object',
        properties: {
          orderId: { type: 'string' },
          amount: { type: 'number', exclusiveMinimum: 0 },
        },
        required: ['orderId', 'amount'],
      },
      outputSchema: { type: 'object', properties: { refunded: { type: 'number' } } },
    })
    expect(registry.getSnapshot()[0]?.inputSchema).not.toHaveProperty('$schema')
  })

  it('publishes nothing when an equal schema is declared again inline', () => {
    const { register, registry } = setup()
    const handle = register({ inputSchema: z.object({ orderId: z.string() }) })
    const before = registry.getSnapshot()

    handle.update({
      name: 'refund',
      label: 'Refund an order',
      inputSchema: z.object({ orderId: z.string() }),
      execute: () => undefined,
    })

    expect(registry.getSnapshot()).toBe(before)
  })

  it('republishes when the description changes, so the agent’s tool list follows', () => {
    const { register, registry } = setup()
    const handle = register({ description: 'Refunds an order.' })
    const before = registry.getSnapshot()

    handle.update({
      name: 'refund',
      label: 'Refund an order',
      description: 'Refunds part of an order.',
      execute: () => undefined,
    })

    expect(registry.getSnapshot()).not.toBe(before)
    expect(registry.getSnapshot()[0]?.description).toBe('Refunds part of an order.')
  })

  it('refuses an inputSchema that is not an object schema', () => {
    const { register } = setup()

    expect(() =>
      register({
        inputSchema: z.string() as unknown as NonNullable<ActionRegistration['inputSchema']>,
      }),
    ).toThrow(/an inputSchema made with z\.object/)
  })

  it('refuses a schema JSON Schema cannot express, since the agent could not call it', () => {
    const { register } = setup()

    expect(() => register({ inputSchema: z.object({ at: z.date() }) })).toThrow(
      /describe the inputSchema of action 'refund' as JSON Schema/,
    )
    expect(() => register({ inputSchema: z.object({ at: z.date() }) })).toThrow(
      expect.objectContaining({ code: 'action/invalid-registration' }),
    )
  })

  it('keeps the action as it was when an update brings a schema it cannot describe', () => {
    const { register, registry } = setup()
    const handle = register({ label: 'Refund an order' })
    const before = registry.getSnapshot()

    expect(() =>
      handle.update({
        name: 'refund',
        label: 'Changed',
        inputSchema: z.object({ at: z.date() }),
        execute: () => undefined,
      }),
    ).toThrow(/JSON Schema/)
    expect(registry.getSnapshot()).toBe(before)
  })

  it('refuses an effect it does not know', () => {
    const { register } = setup()

    expect(() =>
      register({ effect: 'delete' as NonNullable<ActionRegistration['effect']> }),
    ).toThrow(/an effect \(read, write, destructive\)/)
  })

  it('refuses an update that brings a field it cannot accept, and keeps the action as it was', () => {
    const { register, registry } = setup()
    const handle = register({})
    const before = registry.getSnapshot()
    const base = { name: 'refund', label: 'Refund an order', execute: () => undefined }

    expect(() => {
      handle.update({ ...base, effect: 'delete' as NonNullable<ActionRegistration['effect']> })
    }).toThrow(/an effect/)
    expect(() => {
      handle.update({ ...base, label: '' })
    }).toThrow(/a non-empty label/)
    expect(() => {
      handle.update({ ...base, placements: ['menu' as 'palette'] })
    }).toThrow(/a standardized placement/)
    expect(registry.getSnapshot()).toBe(before)
  })

  it('gives a handle whose qualified id follows a rename', () => {
    const { register } = setup()
    const handle = register({})

    handle.update({ name: 'reimburse', label: 'Refund an order', execute: () => undefined })

    expect(handle.qualifiedId).toBe('orders:reimburse')
  })
})
