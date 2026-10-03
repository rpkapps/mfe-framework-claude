import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { StateRecord, UserContextHost } from '@company/mfe-core/user-context'
import { ShellStateStore } from '../shell-state/shell-state-store.ts'
import { createHostUserContext } from '../user-context/host.ts'
import { attachUserContextTheme, readCachedTheme, themeCacheKey } from './user-context-theme.ts'

const schema = z.object({ theme: z.enum(['light', 'dark', 'system']).default('system') })
const user = { id: 'u', name: 'User', tenantId: 'a' }
const cleanups: (() => void)[] = []
afterEach(() => {
  for (const dispose of cleanups.splice(0)) dispose()
  localStorage.clear()
  vi.unstubAllGlobals()
})
function setup(hydrate: () => Promise<readonly StateRecord[]>) {
  const shellState = new ShellStateStore({ user, groups: [], theme: 'light' })
  let revision = 1
  const managed = createHostUserContext({
    persistence: {
      schema,
      adapter: {
        hydrate,
        write: async write => ({ id: 'shell', revision: ++revision, value: write.value }),
      },
    },
    shellState,
  })
  const host = managed.service.host!
  const stop = attach(host, shellState)
  cleanups.push(stop, managed.dispose, () => shellState.dispose())
  return { host, shellState }
}
function attach(host: UserContextHost, shellState: ShellStateStore) {
  return attachUserContextTheme({
    host,
    shellState,
    theme: {
      cacheKey: 'portal:theme',
      select: context => (context as { theme: 'light' | 'dark' | 'system' }).theme,
    },
  })
}
describe('user-context theme', () => {
  it('exposes cached theme during API hydration, then applies and caches confirmed writes', async () => {
    localStorage.setItem(themeCacheKey('portal:theme', user), 'dark')
    let finish!: (records: readonly StateRecord[]) => void
    const { host, shellState } = setup(
      () =>
        new Promise(resolve => {
          finish = resolve
        }),
    )
    expect(shellState.getTheme()).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    finish([{ id: 'shell', revision: 1, value: { theme: 'light' } }])
    await host.prepared()
    expect(shellState.getTheme()).toBe('light')
    const result = await (await host.prepared()).userContext.set('theme', 'dark')
    expect(result.ok).toBe(true)
    expect(shellState.getTheme()).toBe('dark')
    expect(localStorage.getItem(themeCacheKey('portal:theme', user))).toBe('dark')
  })
  it('retains cached theme and cache contents on hydration failure, then applies a retried load', async () => {
    localStorage.setItem(themeCacheKey('portal:theme', user), 'dark')
    let available = false
    const { host, shellState } = setup(async () => {
      if (!available) throw new Error('offline')
      return [{ id: 'shell', revision: 1, value: { theme: 'light' } }]
    })
    await expect(host.prepared()).rejects.toThrow()
    expect(shellState.getTheme()).toBe('dark')
    expect(localStorage.getItem(themeCacheKey('portal:theme', user))).toBe('dark')
    available = true
    host.retry()
    await host.prepared()
    expect(shellState.getTheme()).toBe('light')
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
    const { host, shellState } = setup(async () => [
      { id: 'shell', revision: 1, value: { theme: 'system' } },
    ])
    await host.prepared()
    dark = true
    changed?.()
    expect(shellState.getTheme()).toBe('dark')
    await (await host.prepared()).userContext.set('theme', 'light')
    changed?.()
    expect(shellState.getTheme()).toBe('light')
  })
})

it('replaces a cached preference with the default after a confirmed absent record', async () => {
  localStorage.setItem(themeCacheKey('portal:theme', user), 'dark')
  const { host, shellState } = setup(async () => [{ id: 'shell', revision: 0 }])
  await host.prepared()
  expect(localStorage.getItem(themeCacheKey('portal:theme', user))).toBe('system')
  expect(shellState.getTheme()).toBe('light')
})

it('ignores delayed hydration across identity changes and never hydrates after sign-out', async () => {
  const shellState = new ShellStateStore({ user, groups: [], theme: 'light' })
  const requests: { resolve: (records: readonly StateRecord[]) => void }[] = []
  const hydrate = vi.fn(
    () => new Promise<readonly StateRecord[]>(resolve => requests.push({ resolve })),
  )
  const managed = createHostUserContext({
    persistence: {
      schema,
      adapter: {
        hydrate,
        write: async () => {
          throw new Error('unused')
        },
      },
    },
    shellState,
  })
  localStorage.setItem(themeCacheKey('portal:theme', user), 'dark')
  const nextUser = { ...user, tenantId: 'b' }
  localStorage.setItem(themeCacheKey('portal:theme', nextUser), 'light')
  const stop = attach(managed.service.host!, shellState)
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
  await managed.service.host!.prepared()
  expect(shellState.getTheme()).toBe('light')
  expect(localStorage.getItem(themeCacheKey('portal:theme', nextUser))).toBe('light')
  shellState.apply({ user: null })
  await Promise.resolve()
  expect(hydrate).toHaveBeenCalledTimes(2)
  expect(shellState.getTheme()).toBe('light')
})

it('never caches a record delivered for the next user under the previous identity', async () => {
  const shellState = new ShellStateStore({ user, groups: [], theme: 'light' })
  const nextUser = { ...user, id: 'two' }
  localStorage.setItem(themeCacheKey('portal:theme', user), 'dark')
  localStorage.setItem(themeCacheKey('portal:theme', nextUser), 'light')
  const managed = createHostUserContext({
    persistence: {
      schema,
      adapter: {
        hydrate: async ids =>
          ids.map(id =>
            shellState.getUser()?.id === 'two'
              ? { id, revision: 1, value: { theme: 'light' } }
              : { id, revision: 0 },
          ),
        write: vi.fn(),
        subscribe: listener => {
          if (shellState.getUser()?.id === 'two')
            listener({ id: 'shell', revision: 1, value: { theme: 'light' } })
          return () => {}
        },
      },
    },
    shellState,
  })
  const stop = attach(managed.service.host!, shellState)
  cleanups.push(
    stop,
    () => managed.dispose(),
    () => shellState.dispose(),
  )
  shellState.apply({ user: nextUser })
  await managed.service.host!.prepared()
  expect(localStorage.getItem(themeCacheKey('portal:theme', user))).toBe('dark')
  expect(localStorage.getItem(themeCacheKey('portal:theme', nextUser))).toBe('light')
})
