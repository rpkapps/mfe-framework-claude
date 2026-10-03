import { describe, expect, it, vi } from 'vitest'
import type { Registry, ShellUser } from '@company/mfe-core'
import {
  stateCapabilities,
  type StateContract,
  type UserContextRequirements,
  type UserContextStore,
} from '@company/mfe-core/user-context'
import { ShellStateStore } from '../shell-state/shell-state-store.ts'
import { createHostUserContext, type UserContextAdapter } from './host.ts'

const contract: StateContract = {
  formatVersion: 1,
  id: 'operations',
  revision: 'one',
  node: {
    kind: 'object',
    strict: true,
    fields: {
      units: { kind: 'default', inner: { kind: 'string' }, value: 'metric' },
    },
  },
}
const requirements: UserContextRequirements = {
  protocolVersion: 1,
  ownerId: 'operations',
  contracts: [
    { id: 'operations', revision: 'one', capabilities: stateCapabilities(contract.node) },
  ],
}
const user = { id: 'one', name: 'One', tenantId: 'tenant' }
function setup(initial: ShellUser | null = user, registryContract = contract) {
  const shellState = new ShellStateStore({ user: initial, groups: [], theme: 'light' })
  const hydratedUsers: (string | undefined)[] = []
  const hydrate = vi.fn<UserContextAdapter['hydrate']>(async ids => {
    hydratedUsers.push(shellState.getUser()?.id)
    return ids.map(id => ({ id, revision: 0 }))
  })
  const write = vi.fn<UserContextAdapter['write']>(async operation => ({
    id: operation.id,
    revision: operation.expectedRevision + 1,
    value: operation.value,
  }))
  const unsubscribe = vi.fn()
  const subscribe = vi.fn<NonNullable<UserContextAdapter['subscribe']>>(() => unsubscribe)
  const registry: Registry = {
    rejected: [],
    entries: new Map([
      [
        'operations',
        {
          id: 'operations',
          definitionKind: 'app',
          adapter: 'test',
          manifestUrl: 'memory://operations',
          requiresRuntime: '^1.0.0',
          userContextContract: registryContract,
        },
      ],
    ]),
  }
  const host = createHostUserContext({
    persistence: { adapter: { hydrate, write, subscribe } },
    registry,
    shellState,
  })
  return { ...host, shellState, hydrate, hydratedUsers, write, subscribe, unsubscribe, registry }
}

describe('host user context', () => {
  it('discovers an unmounted owner and exposes no scope in adapter calls', async () => {
    const host = setup()
    const reader = { ...requirements, ownerId: 'reports' }
    await host.service.prepare(reader)
    expect(host.hydrate).toHaveBeenCalledWith(['operations'], expect.any(AbortSignal))
    const store = host.service.bindReadOnly('reports', reader, 'operations')
    expect(store.get('units')).toBe('metric')
    expect(store).not.toHaveProperty('set')
    expect(host.service).not.toHaveProperty('setScope')
    expect(host.subscribe).toHaveBeenCalledWith(expect.any(Function), expect.any(AbortSignal))
    await host.service.bind('operations', requirements).set('units', 'imperial')
    expect(host.write.mock.calls[0]?.[0]).not.toHaveProperty('scope')
    expect(host.write.mock.calls[0]?.[0]).toMatchObject({
      id: 'operations',
      value: { units: 'imperial' },
    })
    host.dispose()
  })

  it('invalidates old bindings before new identity becomes visible and hydrates only the new user', async () => {
    const host = setup()
    await host.service.prepare(requirements)
    const old = host.service.bind('operations', requirements)
    host.shellState.subscribeToField('user', () => {
      expect(() => old.get('units')).toThrow(/Scope changed|disposed/i)
    })
    host.shellState.apply({ user: { ...user, id: 'two' } })
    await host.service.prepare(requirements)
    expect(host.hydrate).toHaveBeenLastCalledWith(['operations'], expect.any(AbortSignal))
    expect(host.hydratedUsers).toEqual(['one', 'two'])
    expect(host.unsubscribe).toHaveBeenCalledTimes(1)
    expect(host.service.inspection?.getSnapshot().generation).toBe(1)
    host.dispose()
  })

  it('makes no persistence or subscription calls while signed out, including after logout', async () => {
    const host = setup(null)
    await expect(host.service.prepare(requirements)).rejects.toThrow('Sign in')
    expect(() => host.service.bind('operations', requirements)).toThrow('Sign in')
    expect(host.hydrate).not.toHaveBeenCalled()
    expect(host.subscribe).not.toHaveBeenCalled()
    host.shellState.apply({ user })
    await host.service.prepare(requirements)
    const store = host.service.bind('operations', requirements)
    host.shellState.apply({ user: null })
    expect((await store.set('units', 'imperial')).ok).toBe(false)
    await expect(host.service.prepare(requirements)).rejects.toThrow('Sign in')
    expect(host.hydrate).toHaveBeenCalledTimes(1)
    expect(host.subscribe).toHaveBeenCalledTimes(1)
    expect(host.write).not.toHaveBeenCalled()
    host.dispose()
  })

  it('keeps the same binding for display-name, theme and group changes', async () => {
    const host = setup()
    await host.service.prepare(requirements)
    const store = host.service.bind('operations', requirements)
    host.shellState.apply({ user: { ...user, name: 'New name' }, groups: ['new'], theme: 'dark' })
    expect(store.get('units')).toBe('metric')
    expect(host.service.inspection?.getSnapshot().generation).toBe(0)
    host.dispose()
  })

  it('rejects metadata that claims another owner', () => {
    expect(() => setup(user, { ...contract, id: 'other' })).toThrow('does not match')
  })

  it('registers shell context from generated metadata and rejects a duplicate owner', async () => {
    const shellState = new ShellStateStore({ user, groups: [], theme: 'light' })
    const persistence = {
      adapter: { hydrate: async () => [{ id: 'operations', revision: 0 }], write: vi.fn() },
    }
    const host = createHostUserContext({
      persistence,
      shellState,
      registry: { entries: new Map(), rejected: [] },
      definition: { contract, requirements },
    })
    await host.service.prepare(requirements)
    expect(host.service.bind('operations', requirements).get('units')).toBe('metric')
    host.dispose()
    const existing = setup()
    expect(() =>
      createHostUserContext({
        persistence,
        shellState,
        registry: existing.registry,
        definition: { contract, requirements },
      }),
    ).toThrow('one current contract')
    existing.dispose()
  })
})

it('does not cache synchronous next-user subscription records under the previous identity', async () => {
  const { attachUserContextTheme, themeCacheKey } = await import('../theme/user-context-theme.ts')
  const shellState = new ShellStateStore({ user, groups: [], theme: 'light' })
  const nextUser = { ...user, id: 'two' }
  const cacheKey = 'review:theme'
  localStorage.setItem(themeCacheKey(cacheKey, user), 'dark')
  localStorage.setItem(themeCacheKey(cacheKey, nextUser), 'light')
  const managed = createHostUserContext({
    persistence: {
      adapter: {
        hydrate: async () => [{ id: 'operations', revision: 0 }],
        write: vi.fn(),
        subscribe: listener => {
          if (shellState.getUser()?.id === 'two')
            listener({ id: 'operations', revision: 1, value: { units: 'light' } })
          return () => {}
        },
      },
    },
    registry: { entries: new Map(), rejected: [] },
    shellState,
    definition: { contract, requirements },
  })
  const stop = attachUserContextTheme({
    service: managed.service,
    requirements,
    shellState,
    theme: { cacheKey, select: value => (value as { units: 'light' | 'dark' }).units },
  })
  try {
    shellState.apply({ user: nextUser })
    await managed.service.prepare(requirements)
    expect(localStorage.getItem(themeCacheKey(cacheKey, user))).toBe('dark')
    expect(localStorage.getItem(themeCacheKey(cacheKey, nextUser))).toBe('light')
  } finally {
    stop()
    managed.dispose()
    shellState.dispose()
    localStorage.removeItem(themeCacheKey(cacheKey, user))
    localStorage.removeItem(themeCacheKey(cacheKey, nextUser))
  }
})

it('blocks an old binding invoked by an earlier identity observer before it reaches the new session adapter', async () => {
  const shellState = new ShellStateStore({ user, groups: [], theme: 'light' })
  let oldStore: UserContextStore | undefined
  let attempted: ReturnType<UserContextStore['set']> | undefined
  const stopEarlierObserver = shellState.observeTransitions(change => {
    if (change.transitions.some(transition => transition.kind === 'identity'))
      attempted = oldStore?.set('units', 'imperial')
  })
  const write = vi.fn<UserContextAdapter['write']>(async operation => ({
    id: operation.id,
    revision: operation.expectedRevision + 1,
    value: operation.value,
  }))
  const host = createHostUserContext({
    persistence: { adapter: { hydrate: async () => [{ id: contract.id, revision: 0 }], write } },
    registry: { entries: new Map(), rejected: [] },
    shellState,
    definition: { contract, requirements },
  })
  try {
    await host.service.prepare(requirements)
    oldStore = host.service.bind(contract.id, requirements)
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

it('blocks stale hydration started by an earlier identity observer', async () => {
  const shellState = new ShellStateStore({ user, groups: [], theme: 'light' })
  let attempted: Promise<void> | undefined
  const stopEarlierObserver = shellState.observeTransitions(change => {
    if (change.transitions.some(transition => transition.kind === 'identity'))
      attempted = host.service.prepare(requirements)
  })
  const hydrate = vi.fn<UserContextAdapter['hydrate']>(async () => [
    { id: contract.id, revision: 0 },
  ])
  const host = createHostUserContext({
    persistence: { adapter: { hydrate, write: vi.fn() } },
    registry: { entries: new Map(), rejected: [] },
    shellState,
    definition: { contract, requirements },
  })
  try {
    shellState.apply({ user: { ...user, id: 'two' } })
    await expect(attempted).rejects.toMatchObject({ code: 'user-context/scope-disposed' })
    expect(hydrate).not.toHaveBeenCalled()
    await host.service.prepare(requirements)
    expect(hydrate).toHaveBeenCalledExactlyOnceWith([contract.id], expect.any(AbortSignal))
  } finally {
    stopEarlierObserver()
    host.dispose()
    shellState.dispose()
  }
})
