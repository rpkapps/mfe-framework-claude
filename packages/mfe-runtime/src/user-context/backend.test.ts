import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import type { Json, StateWrite } from '@company/mfe-core/user-context'
import { createTestUserContextRepository } from '../testing/user-context.ts'
import {
  createUserContextBackend,
  type UserContextBackendOptions,
  type StoredState,
} from './backend.ts'

const signal = (): AbortSignal => new AbortController().signal
function setup() {
  const storage = createTestUserContextRepository()
  const authorize = vi.fn(async () => {})
  const forOwner = (owner: string) =>
    createUserContextBackend({
      repository: storage.repository,
      resolveOwner: async () => owner,
      authorize,
    })
  return { ...storage, authorize, forOwner }
}
function operation(
  id: string,
  value: Json,
  expectedRevision = 0,
  operationId = 'save',
): StateWrite {
  return { scope: 'user-one', id, value, expectedRevision, operationId }
}

describe('opaque user-context persistence', () => {
  it('has no schema configuration and accepts a newly authorized owner without deployment metadata', async () => {
    expectTypeOf<UserContextBackendOptions>().not.toHaveProperty('schema')
    const { forOwner } = setup()
    const backend = forOwner('new-widget')
    const value = { arbitrary: { future: [true, null, { field: 'unknown to the server' }] } }
    expect(await backend.write(operation('new-widget', value), signal())).toEqual({
      id: 'new-widget',
      revision: 1,
      value,
    })
    expect(await backend.hydrate('user-one', ['new-widget', 'another-owner'], signal())).toEqual([
      { id: 'new-widget', revision: 1, value },
      { id: 'another-owner', revision: 0 },
    ])
  })

  it('merges a partial nested value while preserving unknown siblings, unrelated owners, and other users', async () => {
    const { forOwner } = setup()
    const lab = forOwner('lab')
    const shell = forOwner('shell')
    await lab.write(
      operation('lab', {
        selection: { well: '42', run: 'one', future: { retained: true } },
        unknownPreference: { preserve: 'yes' },
        units: 'metric',
      }),
      signal(),
    )
    await shell.write(operation('shell', { theme: 'dark', unknown: 123 }), signal())
    await lab.write({ ...operation('lab', { units: 'imperial' }), scope: 'user-two' }, signal())
    await lab.write(operation('lab', { selection: { run: 'two' } }, 1, 'update-run'), signal())
    expect(await lab.hydrate('user-one', ['lab', 'shell'], signal())).toEqual([
      {
        id: 'lab',
        revision: 2,
        value: {
          selection: { well: '42', run: 'two', future: { retained: true } },
          unknownPreference: { preserve: 'yes' },
          units: 'metric',
        },
      },
      { id: 'shell', revision: 1, value: { theme: 'dark', unknown: 123 } },
    ])
    expect(await lab.hydrate('user-two', ['lab'], signal())).toEqual([
      { id: 'lab', revision: 1, value: { units: 'imperial' } },
    ])
  })

  it('replaces arrays and explicit null without normalizing or injecting domain defaults', async () => {
    const { forOwner } = setup()
    const backend = forOwner('lab')
    await backend.write(
      operation('lab', { array: [1, 2], nested: { retained: true }, old: 'unchanged' }),
      signal(),
    )
    const result = await backend.write(
      operation('lab', { array: [3], nested: null }, 1, 'replace'),
      signal(),
    )
    expect(result.value).toEqual({ array: [3], nested: null, old: 'unchanged' })
    expect(result.value).not.toHaveProperty('units')
  })

  it('preserves JSON property names without mutating object prototypes', async () => {
    const { forOwner } = setup()
    const value = JSON.parse(
      '{"__proto__":{"polluted":"no"},"constructor":{"prototype":{"kept":true}}}',
    ) as Json
    const backend = forOwner('lab')
    await backend.write(operation('lab', value), signal())
    const result = await backend.write(operation('lab', { units: 'metric' }, 1, 'second'), signal())
    expect(JSON.parse(JSON.stringify(result.value))).toEqual({
      ...(value as object),
      units: 'metric',
    })
    expect({}).not.toHaveProperty('polluted')
  })

  it('enforces trusted owner and user policies independently of JSON field names', async () => {
    const { forOwner, authorize, records } = setup()
    const backend = forOwner('lab')
    await expect(
      backend.write(operation('shell', { ownerId: 'lab', theme: 'dark' }), signal()),
    ).rejects.toMatchObject({ code: 'user-context/unauthorized-owner' })
    expect(records.size).toBe(0)
    expect(authorize).not.toHaveBeenCalled()
    authorize.mockRejectedValueOnce(new Error('Wrong authenticated user'))
    await expect(backend.write(operation('lab', { units: 'metric' }), signal())).rejects.toThrow(
      'Wrong authenticated user',
    )
    expect(records.size).toBe(0)
    authorize.mockRejectedValueOnce(new Error('Read forbidden'))
    await expect(backend.hydrate('user-one', ['lab'], signal())).rejects.toThrow('Read forbidden')
  })

  it.each([null, [], 'scalar', { number: Infinity }, { absent: undefined }, { date: new Date() }])(
    'rejects non-object or non-JSON owner data before transaction (%j)',
    async invalid => {
      const { forOwner, records } = setup()
      await expect(
        forOwner('lab').write(operation('lab', invalid as Json), signal()),
      ).rejects.toMatchObject({ code: 'user-context/invalid-value' })
      expect(records.size).toBe(0)
    },
  )

  it('uses CAS and durable receipts for conflicting writes and retries after later updates', async () => {
    const { forOwner } = setup()
    const backend = forOwner('lab')
    const first = operation('lab', { selection: { well: '42' } })
    const accepted = await backend.write(first, signal())
    await backend.write(operation('lab', { selection: { run: 'two' } }, 1, 'second'), signal())
    expect(await backend.write(first, signal())).toEqual(accepted)
    await expect(backend.write({ ...first, value: { selection: null } }, signal())).rejects.toThrow(
      'reused',
    )
    await expect(backend.write({ ...first, operationId: 'stale' }, signal())).rejects.toMatchObject(
      { code: 'user-context/conflict' },
    )
    expect((await backend.hydrate('user-one', ['lab'], signal()))[0]).toMatchObject({
      revision: 2,
      value: { selection: { well: '42', run: 'two' } },
    })
  })

  it('captures the intended patch before a queued transaction starts', async () => {
    let entered!: () => void
    let release!: () => void
    const started = new Promise<void>(resolve => {
      entered = resolve
    })
    const queued = new Promise<void>(resolve => {
      release = resolve
    })
    const backend = createUserContextBackend({
      resolveOwner: async () => 'lab',
      authorize: async () => {},
      repository: {
        read: async () => undefined,
        transact: async (_scope, _owner, update) => {
          entered()
          await queued
          return update(undefined)
        },
      },
    })
    const value = { nested: { intention: 'original' } }
    const pending = backend.write(operation('lab', value), signal())
    await started
    value.nested.intention = 'changed by caller'
    release()
    expect((await pending).value).toEqual({ nested: { intention: 'original' } })
  })

  it('resolves acceptance only after the repository confirms durable completion', async () => {
    let commit!: () => void
    const committed = new Promise<void>(resolve => {
      commit = resolve
    })
    const stored: StoredState[] = []
    const backend = createUserContextBackend({
      resolveOwner: async () => 'lab',
      authorize: async () => {},
      repository: {
        read: async () => stored.at(-1),
        transact: async (_scope, _owner, update) => {
          const next = update(stored.at(-1))
          await committed
          stored.push(next)
          return next
        },
      },
    })
    const accepted = vi.fn()
    const pending = backend.write(operation('lab', { value: 'saved' }), signal()).then(accepted)
    await Promise.resolve()
    await Promise.resolve()
    expect(accepted).not.toHaveBeenCalled()
    expect(stored).toEqual([])
    commit()
    await pending
    expect(accepted).toHaveBeenCalledWith({ id: 'lab', revision: 1, value: { value: 'saved' } })
  })
})
