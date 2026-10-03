import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { afterEach, expect, it, vi } from 'vitest'
import { themeCacheKey } from './user-context-theme.ts'

const html = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../../apps/shell/src/index.html'),
  'utf8',
)
const bootstrap = html.match(/<script>\s*;(\(function \(\) \{[\s\S]*?\}\)\(\))/)?.[1]
afterEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset['userId']
  delete document.documentElement.dataset['tenantId']
  delete document.documentElement.dataset['accountId']
  vi.unstubAllGlobals()
})
it('applies the framework cache before boot using exactly the same identity key', () => {
  const user = { id: 'u / unicode', name: 'User', tenantId: 'tenant', accountId: 'account' }
  localStorage.setItem(themeCacheKey('portal:theme', user), 'dark')
  Object.assign(document.documentElement.dataset, {
    userId: user.id,
    tenantId: user.tenantId,
    accountId: user.accountId,
  })
  expect(bootstrap).toBeDefined()
  runInNewContext(bootstrap ?? '', { window, document })
  expect(document.documentElement.style.colorScheme).toBe('dark')
})
it('uses the system instead of another identity cache before sign-in', () => {
  localStorage.setItem(themeCacheKey('portal:theme', { id: 'u', name: 'User' }), 'dark')
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  runInNewContext(bootstrap ?? '', { window, document })
  expect(document.documentElement.style.colorScheme).toBe('light')
})
