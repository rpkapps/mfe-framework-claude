import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { deny, type ActionRegistration } from '@company/mfe-core'

import { createMemoryRuntime, type MemoryRuntime } from '../testing/memory-runtime.ts'
import { REDACTED, redactInput, type ActionAuditRecord } from './action-audit.ts'
import { ActionRegistry } from './action-registry.ts'
import { codesOf, recordingDiagnostics } from '../__tests__/harness.ts'

describe('redactInput', () => {
  it('replaces values under credential-like keys, whatever their spelling', () => {
    expect(
      redactInput({
        password: 'hunter2',
        apiKey: 'k',
        'x-api-key': 'k',
        client_secret: 's',
        refreshTokens: ['a'],
        Authorization: 'Basic abc',
        nested: { sessionId: 'abc', keep: 1 },
      }),
    ).toEqual({
      password: REDACTED,
      apiKey: REDACTED,
      'x-api-key': REDACTED,
      client_secret: REDACTED,
      refreshTokens: REDACTED,
      Authorization: REDACTED,
      nested: { sessionId: REDACTED, keep: 1 },
    })
  })

  it('leaves keys that only contain such a word in another one', () => {
    expect(redactInput({ author: 'Ada', compass: 'N', tokenizer: 'bpe', passenger: 2 })).toEqual({
      author: 'Ada',
      compass: 'N',
      tokenizer: 'bpe',
      passenger: 2,
    })
  })

  it('replaces a string that is a credential whatever its key', () => {
    expect(
      redactInput({
        note: 'Bearer abc.def',
        jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl',
        pem: '-----BEGIN RSA PRIVATE KEY-----\nMII…',
        plain: 'Refund order A-1',
        prose: 'Basic support is included',
      }),
    ).toEqual({
      note: REDACTED,
      jwt: REDACTED,
      pem: REDACTED,
      plain: 'Refund order A-1',
      prose: 'Basic support is included',
    })
  })

  it('names what JSON cannot hold, and stops at a depth no input needs', () => {
    let deep: unknown = 'bottom'
    for (let level = 0; level < 12; level += 1) deep = { deep }

    expect(
      redactInput({ at: new Date(0), run: () => 1, missing: undefined, nan: Number.NaN }),
    ).toEqual({ at: '[Date]', run: '[function]', missing: null, nan: 'NaN' })
    expect(JSON.stringify(redactInput(deep))).toContain('[too deep]')
  })
})

describe('the audit record', () => {
  const owner = {
    definitionId: 'orders',
    mountToken: 'mount-1',
    kind: 'widget',
    basePath: '',
  } as const

  function setup() {
    const { hub, records } = recordingDiagnostics()
    const audited: ActionAuditRecord[] = []
    let clock = Date.UTC(2026, 8, 25, 12)
    const registry = new ActionRegistry({
      diagnostics: hub,
      audit: record => {
        audited.push(record)
      },
      readUserId: () => 'user-7',
    })
    const register = (registration: Partial<ActionRegistration> = {}) =>
      registry.register(owner, {
        name: 'refund',
        label: 'Refund',
        effect: 'read',
        execute: () => {
          clock += 25
        },
        ...registration,
      })
    vi.spyOn(Date, 'now').mockImplementation(() => clock)
    return { registry, register, audited, records }
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('records who acted, how, in which turn, with what input, and how it ended', async () => {
    const { registry, register, audited } = setup()
    register({ inputSchema: z.object({ orderId: z.string(), token: z.string() }) })

    await registry.execute('orders:refund', {
      caller: 'agent',
      input: { orderId: 'A-1', token: 'secret' },
      turn: { threadId: 'thread-1', turnId: 'turn-4' },
    })

    expect(audited).toEqual([
      {
        actionId: 'orders:refund',
        definitionId: 'orders',
        definitionKind: 'widget',
        actor: 'agent',
        caller: 'agent',
        userId: 'user-7',
        turn: { threadId: 'thread-1', turnId: 'turn-4' },
        outcome: 'executed',
        input: { orderId: 'A-1', token: REDACTED },
        startedAt: '2026-09-25T12:00:00.000Z',
        durationMs: 25,
      },
    ])
  })

  it('records every outcome, with the reason or the error code', async () => {
    const { registry, register, audited } = setup()
    register({ canExecute: () => deny('Closed.') })

    await registry.execute('orders:refund', { caller: 'palette' })
    await registry.execute('orders:missing', { caller: 'system' })

    expect(
      audited.map(({ actor, outcome, reason, errorCode }) => ({
        actor,
        outcome,
        reason,
        errorCode,
      })),
    ).toEqual([
      { actor: 'user', outcome: 'denied', reason: 'Closed.', errorCode: undefined },
      {
        actor: 'system',
        outcome: 'unavailable',
        reason: undefined,
        errorCode: 'action/unavailable',
      },
    ])
  })

  it('reports a sink that throws, and keeps the run’s result', async () => {
    const { hub, records } = recordingDiagnostics()
    const registry = new ActionRegistry({
      diagnostics: hub,
      audit: () => {
        throw new Error('backend down')
      },
    })
    registry.register(owner, { name: 'refund', label: 'Refund', execute: () => 'done' })

    await expect(registry.execute('orders:refund', { caller: 'ui' })).resolves.toEqual({
      status: 'executed',
      value: 'done',
    })
    expect(codesOf(records)).toEqual(['mount/failure'])
  })

  it('does not tell the user of a denial the host’s own code met', async () => {
    const notifyDenial = vi.fn()
    const registry = new ActionRegistry({ notifyDenial })
    registry.register(owner, {
      name: 'refund',
      label: 'Refund',
      canExecute: () => deny('Closed.'),
      execute: () => undefined,
    })

    await registry.execute('orders:refund', { caller: 'system' })

    expect(notifyDenial).not.toHaveBeenCalled()
  })
})

describe('through the runtime', () => {
  let memory: MemoryRuntime | null = null

  afterEach(() => {
    memory?.dispose()
    memory = null
  })

  it('reports each run to telemetry as a framework record, attributed to its owner', async () => {
    memory = createMemoryRuntime()
    const { runtime, telemetry } = memory
    runtime.actions.register(
      { definitionId: 'orders', mountToken: 'mount-1', kind: 'app', basePath: '/orders' },
      { name: 'refund', label: 'Refund', execute: () => undefined },
    )

    await runtime.actions.execute('orders:refund', {
      caller: 'palette',
      input: { orderId: 'A-1', password: 'x' },
    })

    expect(telemetry.frameworkRecords('run action')).toMatchObject([
      {
        level: 'info',
        message: "The user ran 'orders:refund': executed",
        attribution: { definitionId: 'orders', definitionKind: 'app' },
        attributes: {
          'action.id': 'orders:refund',
          'action.actor': 'user',
          'action.caller': 'palette',
          'action.outcome': 'executed',
          'action.user_id': 'test-user',
          'action.input': JSON.stringify({ orderId: 'A-1', password: REDACTED }),
        },
      },
    ])
  })
})
