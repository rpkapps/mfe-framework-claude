import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { allow, deny, type ActionRegistration } from '@company/mfe-core'

import { ActionRegistry, type ActionRegistryOptions } from './action-registry.ts'
import type { ApprovalRequest } from './action-executor.ts'
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
    expect(execute).toHaveBeenCalledWith({ orderId: 'A-1', notify: true })
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

    expect(execute).toHaveBeenCalledWith({})
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

  it('gives a handle whose qualified id follows a rename', () => {
    const { register } = setup()
    const handle = register({})

    handle.update({ name: 'reimburse', label: 'Refund an order', execute: () => undefined })

    expect(handle.qualifiedId).toBe('orders:reimburse')
  })
})
