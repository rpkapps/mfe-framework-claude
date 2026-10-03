import { runInNewContext } from 'node:vm'
import { afterEach, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { ShellStateStore } from '../shell-state/shell-state-store.ts'
import { createHostUserContext } from '../user-context/host.ts'
import { attachUserContextTheme, themeBootstrapScript } from './user-context-theme.ts'

const user = { id: 'u / unicode', name: 'User', tenantId: 'tenant', accountId: 'account' }
afterEach(() => {
  localStorage.clear()
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

/** Caches `theme` for `user` the way a signed-in runtime does, through a confirmed record. */
async function cacheThroughRuntime(theme: 'light' | 'dark'): Promise<void> {
  const shellState = new ShellStateStore({ user, groups: [], theme: 'light' })
  const managed = createHostUserContext({
    persistence: {
      schema: z.object({ theme: z.enum(['light', 'dark', 'system']).default('system') }),
      adapter: {
        hydrate: async ids => ids.map(id => ({ id, revision: 1, value: { theme } })),
        write: vi.fn(),
      },
    },
    shellState,
  })
  const stop = attachUserContextTheme({
    host: managed.service.host!,
    shellState,
    select: context => (context as { theme: 'light' | 'dark' }).theme,
  })
  await managed.service.host!.prepared()
  stop()
  managed.dispose()
  shellState.dispose()
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

it('uses the system instead of another identity cache before sign-in', async () => {
  lightSystem()
  await cacheThroughRuntime('dark')
  bootstrap()
  expect(document.documentElement.style.colorScheme).toBe('light')
  Object.assign(document.documentElement.dataset, { userId: user.id })
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
