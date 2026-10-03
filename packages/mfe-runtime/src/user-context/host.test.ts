import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { ShellUser } from '@company/mfe-core'
import type {
  UserContextAdapter,
  UserContextOwner,
  UserContextStore,
} from '@company/mfe-core/user-context'
import { ShellStateStore } from '../shell-state/shell-state-store.ts'
import { createHostUserContext } from './host.ts'

const operations: UserContextOwner = {
  id: 'operations',
  userContext: { schema: z.object({ units: z.string().default('metric') }) },
}
const reports: UserContextOwner = {
  id: 'reports',
  userContext: { reads: { operations: z.object({ units: z.string().default('metric') }) } },
}
const user = { id: 'one', name: 'One', tenantId: 'tenant' }
function setup(initial: ShellUser | null = user) {
  const shellState = new ShellStateStore({ user: initial, groups: [], theme: 'light' })
  const hydratedUsers: (string | undefined)[] = []
  const hydrate = vi.fn<UserContextAdapter['hydrate']>(async ids => {
    hydratedUsers.push(shellState.getUser()?.id)
    return ids.map(id => ({ id, revision: 0 }))
  })
  const write = vi.fn<UserContextAdapter['write']>(async request => ({
    id: request.id,
    revision: 1,
    value: request.value,
  }))
  const unsubscribe = vi.fn()
  const subscribe = vi.fn<NonNullable<UserContextAdapter['subscribe']>>(() => unsubscribe)
  const host = createHostUserContext({
    persistence: { adapter: { hydrate, write, subscribe } },
    shellState,
  })
  return { ...host, shellState, hydrate, hydratedUsers, write, subscribe, unsubscribe }
}

describe('host user context', () => {
  it('passes owner requests straight to the adapter, without any user scope', async () => {
    const host = setup()
    await host.service.prepare(reports)
    expect(host.hydrate).toHaveBeenCalledWith(['operations'], expect.any(AbortSignal))
    const store = host.service.bindReadOnly(reports, 'operations')
    expect(store.get('units')).toBe('metric')
    expect(store).not.toHaveProperty('set')
    expect(host.subscribe).toHaveBeenCalledWith(expect.any(Function), expect.any(AbortSignal))
    await host.service.prepare(operations)
    await host.service.bind(operations).set('units', 'imperial')
    expect(host.write.mock.calls[0]?.[0]).toEqual({
      id: 'operations',
      value: { units: 'imperial' },
    })
    host.dispose()
  })

  it('resets on a user change, so old bindings fail and only the new user is hydrated', async () => {
    const host = setup()
    await host.service.prepare(operations)
    const old = host.service.bind(operations)
    host.shellState.subscribeToField('user', () => {
      expect(() => old.get('units')).toThrow('previous signed-in user')
    })
    host.shellState.apply({ user: { ...user, id: 'two' } })
    await host.service.prepare(operations)
    expect(host.hydratedUsers).toEqual(['one', 'two'])
    expect(host.unsubscribe).toHaveBeenCalledTimes(1)
    expect(host.service.inspection.getSnapshot().generation).toBe(1)
    host.dispose()
  })

  it('makes no persistence or subscription calls while signed out, including after logout', async () => {
    const host = setup(null)
    await expect(host.service.prepare(operations)).rejects.toThrow('Sign in')
    expect(() => host.service.bind(operations)).toThrow('Sign in')
    expect(host.hydrate).not.toHaveBeenCalled()
    expect(host.subscribe).not.toHaveBeenCalled()
    host.shellState.apply({ user })
    await host.service.prepare(operations)
    const store = host.service.bind(operations)
    host.shellState.apply({ user: null })
    expect((await store.set('units', 'imperial')).ok).toBe(false)
    await expect(host.service.prepare(operations)).rejects.toThrow('Sign in')
    expect(host.hydrate).toHaveBeenCalledTimes(1)
    expect(host.subscribe).toHaveBeenCalledTimes(1)
    expect(host.write).not.toHaveBeenCalled()
    host.dispose()
  })

  it('keeps the same binding for display-name, theme and group changes', async () => {
    const host = setup()
    await host.service.prepare(operations)
    const store = host.service.bind(operations)
    host.shellState.apply({ user: { ...user, name: 'New name' }, groups: ['new'], theme: 'dark' })
    expect(store.get('units')).toBe('metric')
    expect(host.service.inspection.getSnapshot().generation).toBe(0)
    host.dispose()
  })

  it("prepares the shell's own slice once per user, keeps a failure and prepares again on retry", async () => {
    const shellState = new ShellStateStore({ user, groups: [], theme: 'light' })
    const schema = z.object({ theme: z.string().default('system') })
    let available = false
    const hydrate = vi.fn<UserContextAdapter['hydrate']>(async ids => {
      if (!available) throw new Error('offline')
      return ids.map(id => ({ id, revision: 0 }))
    })
    const managed = createHostUserContext({
      persistence: { schema, adapter: { hydrate, write: vi.fn() } },
      shellState,
    })
    const host = managed.service.host!
    const changed = vi.fn()
    host.subscribe(changed)
    expect(host).toMatchObject({ id: 'shell', userContext: { schema } })
    const failed = host.prepared()
    await expect(failed).rejects.toThrow('offline')
    expect(host.prepared()).toBe(failed)
    available = true
    host.retry()
    expect(changed).toHaveBeenCalledTimes(1)
    const prepared = await host.prepared()
    expect(prepared.userContext.get('theme')).toBe('system')
    host.retry()
    expect(await host.prepared()).toBe(prepared)
    expect(hydrate).toHaveBeenCalledTimes(2)
    shellState.apply({ user: { ...user, id: 'two' } })
    expect(changed).toHaveBeenCalledTimes(2)
    expect(() => prepared.userContext.get('theme')).toThrow('previous signed-in user')
    expect((await host.prepared()).userContext.get('theme')).toBe('system')
    managed.dispose()
    expect(setup().service.host).toBeUndefined()
  })
})

it('blocks an old binding invoked by an earlier identity observer before it reaches the adapter', async () => {
  const shellState = new ShellStateStore({ user, groups: [], theme: 'light' })
  let oldStore: UserContextStore | undefined
  let attempted: ReturnType<UserContextStore['set']> | undefined
  const stopEarlierObserver = shellState.observeTransitions(change => {
    if (change.transitions.some(transition => transition.kind === 'identity'))
      attempted = oldStore?.set('units', 'imperial')
  })
  const write = vi.fn<UserContextAdapter['write']>()
  const host = createHostUserContext({
    persistence: {
      adapter: { hydrate: async () => [{ id: operations.id, revision: 0 }], write },
    },
    shellState,
  })
  try {
    await host.service.prepare(operations)
    oldStore = host.service.bind(operations)
    shellState.apply({ user: { ...user, id: 'two' } })
    expect(await attempted).toMatchObject({
      ok: false,
      error: { code: 'user-context/scope-disposed' },
    })
    expect(write).not.toHaveBeenCalled()
  } finally {
    stopEarlierObserver()
    host.dispose()
    shellState.dispose()
  }
})

it('blocks hydration started by an earlier identity observer', async () => {
  const shellState = new ShellStateStore({ user, groups: [], theme: 'light' })
  let attempted: Promise<void> | undefined
  const stopEarlierObserver = shellState.observeTransitions(change => {
    if (change.transitions.some(transition => transition.kind === 'identity'))
      attempted = host.service.prepare(operations)
  })
  const hydrate = vi.fn<UserContextAdapter['hydrate']>(async () => [
    { id: operations.id, revision: 0 },
  ])
  const host = createHostUserContext({
    persistence: { adapter: { hydrate, write: vi.fn() } },
    shellState,
  })
  try {
    shellState.apply({ user: { ...user, id: 'two' } })
    await expect(attempted).rejects.toMatchObject({ code: 'user-context/scope-disposed' })
    expect(hydrate).not.toHaveBeenCalled()
    await host.service.prepare(operations)
    expect(hydrate).toHaveBeenCalledExactlyOnceWith([operations.id], expect.any(AbortSignal))
  } finally {
    stopEarlierObserver()
    host.dispose()
    shellState.dispose()
  }
})
