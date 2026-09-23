import { describe, expect, it } from 'vitest'
import { loadPeer, requirePeers } from './peer-require.ts'

describe('requirePeers', () => {
  it('does not throw when every specifier already resolves', () => {
    expect(() => requirePeers(['eslint', 'typescript-eslint'], 'pnpm add -D eslint')).not.toThrow()
  })

  it('throws a message naming exactly the missing package and how to install it', () => {
    expect(() =>
      requirePeers(
        ['@company/definitely-not-a-real-peer'],
        'pnpm add -D @company/definitely-not-a-real-peer',
      ),
    ).toThrowError(
      /@company\/definitely-not-a-real-peer.*optional peer dependency.*pnpm add -D @company\/definitely-not-a-real-peer/s,
    )
  })

  it('names every missing package at once, not only the first', () => {
    expect(() =>
      requirePeers(
        ['@company/not-a-real-peer-one', 'eslint', '@company/not-a-real-peer-two'],
        'pnpm add -D @company/not-a-real-peer-one @company/not-a-real-peer-two',
      ),
    ).toThrowError(/@company\/not-a-real-peer-one.*@company\/not-a-real-peer-two/s)
  })

  it('lets an installed peer through unresolved, so `loadPeer` can load the real module', () => {
    expect(() => requirePeers(['eslint'], 'pnpm add -D eslint')).not.toThrow()
    expect(loadPeer<{ RuleTester: unknown }>('eslint').RuleTester).toBeDefined()
  })
})
