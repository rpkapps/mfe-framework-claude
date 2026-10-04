import { runInNewContext } from 'node:vm'
import { afterEach, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { HOST_SCOPE, storedKey } from '@company/mfe-core'

import { createMfeRuntime } from '../runtime/create-runtime.ts'
import { createNoopTelemetryProvider } from '../telemetry/tracer.ts'
import { createInProcessLoader } from '../testing/in-process-loader.ts'
import { createMemoryNavigationBridge } from '../testing/memory-navigation-bridge.ts'
import { createMemoryUserStorage } from '../testing/memory-user-storage.ts'
import { themeBootstrapScript } from './stored-theme.ts'

const user = { id: 'u / unicode', name: 'User', tenantId: 'tenant', accountId: 'account' }
afterEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  delete document.documentElement.dataset['userId']
  delete document.documentElement.dataset['tenantId']
  delete document.documentElement.dataset['accountId']
  document.documentElement.classList.remove('dark')
  document.documentElement.style.colorScheme = ''
  vi.unstubAllGlobals()
})

function lightSystem(): void {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

/** Runs the script as a browser would, with nothing from this module in scope. */
function bootstrap(): void {
  runInNewContext(themeBootstrapScript(), {
    document,
    localStorage,
    matchMedia: (query: string) => matchMedia(query),
  })
}

/** Caches `theme` for `user` the way a signed-in runtime does, through a confirmed value. */
async function cacheThroughRuntime(theme: 'light' | 'dark'): Promise<void> {
  const handle = createMfeRuntime({
    registryEntries: [],
    adapters: [],
    loader: createInProcessLoader(new Map()),
    shellState: { user, groups: [] },
    telemetryProvider: createNoopTelemetryProvider(),
    navigationBridge: createMemoryNavigationBridge(['/']),
    storage: {
      user: createMemoryUserStorage({ [HOST_SCOPE]: { theme: { v: 1, d: theme, revision: 1 } } }),
    },
    theme: storedKey('theme', z.enum(['light', 'dark', 'system']).default('system'), {
      storage: 'user',
    }),
  })
  await handle.runtime.storage.whenLoaded()
  handle.dispose()
}

it('applies the runtime cache of the user the server names before boot', async () => {
  lightSystem()
  await cacheThroughRuntime('dark')
  document.documentElement.classList.remove('dark')
  Object.assign(document.documentElement.dataset, {
    userId: user.id,
    tenantId: user.tenantId,
    accountId: user.accountId,
  })
  bootstrap()
  expect(document.documentElement.classList.contains('dark')).toBe(true)
  expect(document.documentElement.style.colorScheme).toBe('dark')
})

it('starts in the last signed-in user’s theme when the server names nobody', async () => {
  lightSystem()
  await cacheThroughRuntime('dark')
  document.documentElement.classList.remove('dark')
  bootstrap()
  expect(document.documentElement.classList.contains('dark')).toBe(true)
  expect(document.documentElement.style.colorScheme).toBe('dark')
})

it('uses the system, not the last user’s theme, for a different user the server names', async () => {
  lightSystem()
  await cacheThroughRuntime('dark')
  Object.assign(document.documentElement.dataset, { userId: user.id })
  bootstrap()
  expect(document.documentElement.style.colorScheme).toBe('light')
})

it('uses the system before anyone has signed in on this browser', () => {
  lightSystem()
  bootstrap()
  expect(document.documentElement.style.colorScheme).toBe('light')
})

it('leaves the document as it stands when storage is blocked', () => {
  document.documentElement.classList.add('dark')
  document.documentElement.dataset['userId'] = user.id
  runInNewContext(themeBootstrapScript(), {
    document,
    get localStorage(): Storage {
      throw new Error('blocked')
    },
  })
  expect(document.documentElement.classList.contains('dark')).toBe(true)
})
