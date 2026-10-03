import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  stateCapabilities,
  type StateContract,
  type StateRecord,
  type UserContextRequirements,
} from '@company/mfe-core/user-context'
import { ShellStateStore } from '../shell-state/shell-state-store.ts'
import { UserContextRuntime } from '../user-context/store.ts'
import { attachUserContextTheme, readCachedTheme, themeCacheKey } from './user-context-theme.ts'

const contract: StateContract = {
  formatVersion: 1,
  id: 'shell',
  revision: 'theme',
  node: {
    kind: 'object',
    strict: true,
    fields: {
      theme: {
        kind: 'default',
        inner: { kind: 'enum', values: ['light', 'dark', 'system'] },
        value: 'system',
      },
    },
  },
}
const requirements: UserContextRequirements = {
  protocolVersion: 1,
  ownerId: 'shell',
  contracts: [{ id: 'shell', revision: 'theme', capabilities: stateCapabilities(contract.node) }],
}
const user = { id: 'u', name: 'User', tenantId: 'a' }
const cleanups: (() => void)[] = []
afterEach(() => {
  for (const dispose of cleanups.splice(0)) dispose()
  localStorage.clear()
  vi.unstubAllGlobals()
})
function setup(hydrate: () => Promise<readonly StateRecord[]>) {
  const shellState = new ShellStateStore({ user, groups: [], theme: 'light' })
  const runtime = new UserContextRuntime({
    scope: 'one',
    schema: { formatVersion: 1, contracts: [contract] },
    adapter: {
      hydrate,
      write: async write => ({
        id: 'shell',
        revision: write.expectedRevision + 1,
        value: write.value,
      }),
    },
  })
  const stop = attachUserContextTheme({
    service: runtime,
    requirements,
    shellState,
    theme: {
      cacheKey: 'portal:theme',
      select: context => (context as { theme: 'light' | 'dark' | 'system' }).theme,
    },
  })
  cleanups.push(
    stop,
    () => runtime.dispose(),
    () => shellState.dispose(),
  )
  return { runtime, shellState }
}
describe('user-context theme', () => {
  it('exposes cached theme during API hydration, then applies and caches confirmed writes', async () => {
    localStorage.setItem(themeCacheKey('portal:theme', user), 'dark')
    let finish!: (records: readonly StateRecord[]) => void
    const { runtime, shellState } = setup(
      () =>
        new Promise(resolve => {
          finish = resolve
        }),
    )
    expect(shellState.getTheme()).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    finish([{ id: 'shell', revision: 1, value: { theme: 'light' } }])
    await runtime.prepare(requirements)
    expect(shellState.getTheme()).toBe('light')
    const result = await runtime
      .bind<{ theme: 'light' | 'dark' }>('shell', requirements)
      .set('theme', 'dark')
    expect(result.ok).toBe(true)
    expect(shellState.getTheme()).toBe('dark')
    expect(localStorage.getItem(themeCacheKey('portal:theme', user))).toBe('dark')
  })
  it('retains cached theme and cache contents on hydration failure', async () => {
    localStorage.setItem(themeCacheKey('portal:theme', user), 'dark')
    const { runtime, shellState } = setup(async () => {
      throw new Error('offline')
    })
    await expect(runtime.prepare(requirements)).rejects.toThrow()
    expect(shellState.getTheme()).toBe('dark')
    expect(localStorage.getItem(themeCacheKey('portal:theme', user))).toBe('dark')
  })
  it('partitions caches by tenant/account/user and ignores malformed or unknown identities', () => {
    localStorage.setItem(themeCacheKey('portal:theme', user), 'dark')
    expect(readCachedTheme('portal:theme', user)).toBe('dark')
    expect(readCachedTheme('portal:theme', { ...user, tenantId: 'b' })).toBe('system')
    expect(readCachedTheme('portal:theme', { ...user, accountId: 'b' })).toBe('system')
    expect(readCachedTheme('portal:theme', undefined)).toBe('system')
    localStorage.setItem(themeCacheKey('portal:theme', user), 'invalid')
    expect(readCachedTheme('portal:theme', user)).toBe('system')
  })
  it('follows system changes only when the persisted preference is system', async () => {
    let dark = false
    let changed: (() => void) | undefined
    const remove = vi.fn()
    vi.stubGlobal('matchMedia', () => ({
      get matches() {
        return dark
      },
      addEventListener: (_name: string, listener: () => void) => {
        changed = listener
      },
      removeEventListener: remove,
    }))
    const { runtime, shellState } = setup(async () => [
      { id: 'shell', revision: 1, value: { theme: 'system' } },
    ])
    await runtime.prepare(requirements)
    dark = true
    changed?.()
    expect(shellState.getTheme()).toBe('dark')
    await runtime
      .bind<{ theme: 'light' | 'dark' | 'system' }>('shell', requirements)
      .set('theme', 'light')
    changed?.()
    expect(shellState.getTheme()).toBe('light')
  })
})

it('replaces a cached preference with the default after a confirmed absent record', async () => {
  localStorage.setItem(themeCacheKey('portal:theme', user), 'dark')
  const { runtime, shellState } = setup(async () => [{ id: 'shell', revision: 0 }])
  await runtime.prepare(requirements)
  expect(localStorage.getItem(themeCacheKey('portal:theme', user))).toBe('system')
  expect(shellState.getTheme()).toBe('light')
})

it('ignores delayed hydration across identity changes and never hydrates after sign-out', async () => {
  const { createHostUserContext } = await import('../user-context/host.ts')
  const shellState = new ShellStateStore({ user, groups: [], theme: 'light' })
  const requests: { resolve: (records: readonly StateRecord[]) => void }[] = []
  const hydrate = vi.fn(
    () => new Promise<readonly StateRecord[]>(resolve => requests.push({ resolve })),
  )
  const managed = createHostUserContext({
    persistence: {
      adapter: {
        hydrate,
        write: async () => {
          throw new Error('unused')
        },
      },
    },
    registry: { entries: new Map(), rejected: [] },
    shellState,
    definition: { contract, requirements },
  })
  localStorage.setItem(themeCacheKey('portal:theme', user), 'dark')
  const nextUser = { ...user, tenantId: 'b' }
  localStorage.setItem(themeCacheKey('portal:theme', nextUser), 'light')
  const stop = attachUserContextTheme({
    service: managed.service,
    requirements,
    shellState,
    theme: {
      cacheKey: 'portal:theme',
      select: context => (context as { theme: 'light' | 'dark' | 'system' }).theme,
    },
  })
  cleanups.push(
    stop,
    () => managed.dispose(),
    () => shellState.dispose(),
  )
  expect(shellState.getTheme()).toBe('dark')
  shellState.apply({ user: nextUser })
  expect(shellState.getTheme()).toBe('light')
  requests[0]?.resolve([{ id: 'shell', revision: 1, value: { theme: 'dark' } }])
  requests[1]?.resolve([{ id: 'shell', revision: 1, value: { theme: 'light' } }])
  await managed.service.prepare(requirements)
  expect(shellState.getTheme()).toBe('light')
  expect(localStorage.getItem(themeCacheKey('portal:theme', nextUser))).toBe('light')
  shellState.apply({ user: null })
  await Promise.resolve()
  expect(hydrate).toHaveBeenCalledTimes(2)
  expect(shellState.getTheme()).toBe('light')
})
