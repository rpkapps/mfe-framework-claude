import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import {
  HOST_SCOPE,
  storedKey,
  type ShellUser,
  type StoredRow,
  type UserStorageAdapter,
  type UserStorageState,
} from '@company/mfe-core'

import { createMfeRuntime, type MfeRuntimeHandle } from '../runtime/create-runtime.ts'
import { createNoopTelemetryProvider } from '../telemetry/tracer.ts'
import { createInProcessLoader } from '../testing/in-process-loader.ts'
import { createMemoryNavigationBridge } from '../testing/memory-navigation-bridge.ts'
import { createMemoryUserStorage } from '../testing/memory-user-storage.ts'
import { cachedTheme, themeCacheKey } from './stored-theme.ts'

const themeKey = storedKey('theme', z.enum(['light', 'dark', 'system']).default('system'), {
  storage: 'user',
})
const user: ShellUser = { id: 'u', name: 'User', tenantId: 'a' }
const handles: MfeRuntimeHandle[] = []

afterEach(() => {
  for (const handle of handles.splice(0)) handle.dispose()
  localStorage.clear()
  sessionStorage.clear()
  document.documentElement.classList.remove('dark')
  document.documentElement.style.colorScheme = ''
  vi.unstubAllGlobals()
})

function themed(theme: 'light' | 'dark' | 'system', revision = 1): UserStorageState {
  return { [HOST_SCOPE]: { theme: { v: 1, d: theme, revision } } }
}

function boot(adapter: UserStorageAdapter, signedIn: ShellUser | null = user): MfeRuntimeHandle {
  const handle = createMfeRuntime({
    registryEntries: [],
    adapters: [],
    loader: createInProcessLoader(new Map()),
    shellState: { user: signedIn, groups: [] },
    telemetryProvider: createNoopTelemetryProvider(),
    navigationBridge: createMemoryNavigationBridge(['/']),
    storage: { user: adapter },
    theme: themeKey,
  })
  handles.push(handle)
  return handle
}

/** A load that waits for the test, so what shows before it settles can be checked. */
function deferredLoads() {
  const loads: { resolve(state: UserStorageState): void; reject(error: Error): void }[] = []
  const adapter: UserStorageAdapter = {
    load: () =>
      new Promise<UserStorageState>((resolve, reject) => {
        loads.push({ resolve, reject })
      }),
    save: async (_owner, _key, value) =>
      value === null ? null : ({ ...value, revision: 2 } satisfies StoredRow),
  }
  return { adapter, loads }
}

function lightSystem(): void {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

describe('the stored theme', () => {
  it('shows the cached theme while loading, then applies and caches confirmed values', async () => {
    localStorage.setItem(themeCacheKey(user), 'dark')
    const { adapter, loads } = deferredLoads()
    const { runtime } = boot(adapter)
    expect(runtime.shellState.getTheme()).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    loads[0]?.resolve(themed('light'))
    await runtime.storage.whenLoaded()
    expect(runtime.shellState.getTheme()).toBe('light')
    expect(document.documentElement.style.colorScheme).toBe('light')

    const host = runtime.storage.forCaller({ owner: HOST_SCOPE })
    const saving = host.set(themeKey, 'dark')
    // Applied at once, and cached only once the backend confirmed it.
    expect(runtime.shellState.getTheme()).toBe('dark')
    expect(localStorage.getItem(themeCacheKey(user))).toBe('light')
    await saving
    expect(localStorage.getItem(themeCacheKey(user))).toBe('dark')
  })

  it('keeps the cached theme after a failed load, then applies a retried one', async () => {
    localStorage.setItem(themeCacheKey(user), 'dark')
    const { adapter, loads } = deferredLoads()
    const { runtime } = boot(adapter)
    loads[0]?.reject(new Error('offline'))
    await runtime.storage.whenLoaded()
    expect(runtime.shellState.getTheme()).toBe('dark')
    expect(localStorage.getItem(themeCacheKey(user))).toBe('dark')

    const retried = runtime.storage.bind({ owner: HOST_SCOPE }, themeKey).retry()
    loads[1]?.resolve(themed('light'))
    await retried
    expect(runtime.shellState.getTheme()).toBe('light')
  })

  it('rolls a rejected save back to the confirmed theme', async () => {
    const storage = createMemoryUserStorage(themed('light'))
    const { runtime } = boot({ ...storage, save: () => Promise.reject(new Error('down')) })
    await runtime.storage.whenLoaded()
    await expect(
      runtime.storage.forCaller({ owner: HOST_SCOPE }).set(themeKey, 'dark'),
    ).rejects.toMatchObject({ code: 'storage/persistence-failed' })
    expect(runtime.shellState.getTheme()).toBe('light')
    expect(localStorage.getItem(themeCacheKey(user))).toBe('light')
  })

  it('caches the default after a confirmed absent value', async () => {
    lightSystem()
    localStorage.setItem(themeCacheKey(user), 'dark')
    const { runtime } = boot(createMemoryUserStorage())
    await runtime.storage.whenLoaded()
    expect(localStorage.getItem(themeCacheKey(user))).toBe('system')
    expect(runtime.shellState.getTheme()).toBe('light')
  })

  it('keeps the last usable theme when the stored value fails the schema', async () => {
    localStorage.setItem(themeCacheKey(user), 'dark')
    const { runtime } = boot(
      createMemoryUserStorage({ [HOST_SCOPE]: { theme: { v: 1, d: 'sepia', revision: 1 } } }),
    )
    await runtime.storage.whenLoaded()
    expect(runtime.shellState.getTheme()).toBe('dark')
    expect(localStorage.getItem(themeCacheKey(user))).toBe('dark')
  })

  it('partitions caches by tenant, account and user and ignores unknown identities', () => {
    lightSystem()
    localStorage.setItem(themeCacheKey(user), 'dark')
    expect(cachedTheme(user)).toBe('dark')
    expect(cachedTheme({ ...user, tenantId: 'b' })).toBe('light')
    expect(cachedTheme({ ...user, accountId: 'b' })).toBe('light')
    expect(cachedTheme(undefined)).toBe('light')
    localStorage.setItem(themeCacheKey(user), 'invalid')
    expect(cachedTheme(user)).toBe('light')
  })

  it('follows the system only while the stored preference is system', async () => {
    let dark = false
    let changed: (() => void) | undefined
    vi.stubGlobal('matchMedia', () => ({
      get matches() {
        return dark
      },
      addEventListener: (_name: string, listener: () => void) => {
        changed = listener
      },
      removeEventListener: () => {},
    }))
    const { runtime } = boot(createMemoryUserStorage(themed('system')))
    await runtime.storage.whenLoaded()
    dark = true
    changed?.()
    expect(runtime.shellState.getTheme()).toBe('dark')
    await runtime.storage.forCaller({ owner: HOST_SCOPE }).set(themeKey, 'light')
    changed?.()
    expect(runtime.shellState.getTheme()).toBe('light')
  })

  it('switches to the next user’s cache on sign-in and never caches a late load across users', async () => {
    const nextUser = { ...user, tenantId: 'b' }
    localStorage.setItem(themeCacheKey(user), 'dark')
    localStorage.setItem(themeCacheKey(nextUser), 'light')
    const { adapter, loads } = deferredLoads()
    const { runtime } = boot(adapter)
    expect(runtime.shellState.getTheme()).toBe('dark')

    runtime.shellState.apply({ user: nextUser })
    expect(runtime.shellState.getTheme()).toBe('light')
    // The previous user's load settles late; nothing of it is applied or cached.
    loads[0]?.resolve(themed('dark'))
    loads[1]?.resolve(themed('light'))
    await runtime.storage.whenLoaded()
    expect(runtime.shellState.getTheme()).toBe('light')
    expect(localStorage.getItem(themeCacheKey(user))).toBe('dark')
    expect(localStorage.getItem(themeCacheKey(nextUser))).toBe('light')
  })

  it('pauses transitions for the restyle a switch causes, then restores them', async () => {
    // jsdom has no adopted style sheets; the browser's are a plain settable array.
    Object.defineProperty(document, 'adoptedStyleSheets', {
      value: [],
      writable: true,
      configurable: true,
    })
    const restyled: { dark: boolean; rules: string[] }[] = []
    const computed = vi.spyOn(window, 'getComputedStyle').mockImplementation(() => {
      restyled.push({
        dark: document.documentElement.classList.contains('dark'),
        rules: document.adoptedStyleSheets.flatMap(sheet =>
          [...sheet.cssRules].map(rule => rule.cssText),
        ),
      })
      return document.documentElement.style
    })
    try {
      const storage = createMemoryUserStorage(themed('light'))
      const { runtime } = boot(storage)
      await runtime.storage.whenLoaded()
      restyled.length = 0
      vi.useFakeTimers()
      storage.write(HOST_SCOPE, 'theme', { v: 1, d: 'dark' })
      const paused = [expect.stringMatching(/transition: none !important/)]
      expect(restyled).toEqual([{ dark: true, rules: paused }])
      // A switch back before transitions resume keeps the one pause open rather than adding another.
      storage.write(HOST_SCOPE, 'theme', { v: 1, d: 'light' })
      expect(restyled).toEqual([
        { dark: true, rules: paused },
        { dark: false, rules: paused },
      ])
      vi.runAllTimers()
      expect(document.adoptedStyleSheets).toEqual([])
      // The same theme again changes nothing, so nothing is paused.
      storage.write(HOST_SCOPE, 'theme', { v: 1, d: 'light' })
      expect(restyled).toHaveLength(2)
    } finally {
      vi.useRealTimers()
      computed.mockRestore()
      delete (document as { adoptedStyleSheets?: unknown }).adoptedStyleSheets
    }
  })

  it('stops painting once the runtime is disposed', async () => {
    const storage = createMemoryUserStorage(themed('light'))
    const handle = boot(storage)
    await handle.runtime.storage.whenLoaded()
    handle.dispose()
    storage.write(HOST_SCOPE, 'theme', { v: 1, d: 'dark' })
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })
})
