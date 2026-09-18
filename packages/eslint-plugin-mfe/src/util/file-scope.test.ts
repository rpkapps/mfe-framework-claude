import { describe, expect, it } from 'vitest'
import { matchesAnyScope, normalizePath } from './file-scope.ts'

describe('matchesAnyScope', () => {
  it('matches nothing when no scope is configured, so a scoped rule is inert', () => {
    expect(matchesAnyScope('src/widgets/panel.ts', [])).toBe(false)
  })

  it('anchors a bare pattern anywhere in the tree', () => {
    expect(matchesAnyScope('packages/mfe-host/src/storage/adapter.ts', ['src/storage/**'])).toBe(
      true,
    )
    expect(
      matchesAnyScope('/repo/packages/mfe-host/src/storage/adapter.ts', ['src/storage/**']),
    ).toBe(true)
    expect(matchesAnyScope('src/storage/adapter.ts', ['src/storage/**'])).toBe(true)
  })

  it('does not let a single star cross a directory separator', () => {
    expect(matchesAnyScope('src/widgets/panel.ts', ['src/*.ts'])).toBe(false)
    expect(matchesAnyScope('src/panel.ts', ['src/*.ts'])).toBe(true)
  })

  it('lets a double star match zero directories', () => {
    expect(matchesAnyScope('panel.ts', ['**/*.ts'])).toBe(true)
    expect(matchesAnyScope('a/b/c/panel.ts', ['**/*.ts'])).toBe(true)
  })

  it('expands a flat alternation', () => {
    expect(matchesAnyScope('src/widgets/panel.tsx', ['src/widgets/**/*.{ts,tsx}'])).toBe(true)
    expect(matchesAnyScope('src/widgets/panel.css', ['src/widgets/**/*.{ts,tsx}'])).toBe(false)
  })

  it('matches a single character with a question mark', () => {
    expect(matchesAnyScope('src/a.ts', ['src/?.ts'])).toBe(true)
    expect(matchesAnyScope('src/ab.ts', ['src/?.ts'])).toBe(false)
  })

  it('treats a dot as a literal rather than as any character', () => {
    expect(matchesAnyScope('src/bootstrapXstorage.ts', ['src/bootstrap.storage.ts'])).toBe(false)
    expect(matchesAnyScope('src/bootstrap.storage.ts', ['src/bootstrap.storage.ts'])).toBe(true)
  })

  it('takes any of several patterns', () => {
    const scopes = ['packages/mfe-host/src/storage/**', 'apps/shell/src/bootstrap/storage.ts']
    expect(matchesAnyScope('apps/shell/src/bootstrap/storage.ts', scopes)).toBe(true)
    expect(matchesAnyScope('apps/shell/src/bootstrap/auth.ts', scopes)).toBe(false)
  })

  it('normalises Windows separators and a leading ./', () => {
    expect(normalizePath('.\\src\\widgets\\panel.ts')).toBe('src/widgets/panel.ts')
    expect(matchesAnyScope('C:\\repo\\src\\widgets\\panel.ts', ['src/widgets/**'])).toBe(true)
  })
})
