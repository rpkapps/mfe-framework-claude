import { createMfeTestEnvironment } from '@company/mfe-react/testing'
import { renderHook } from '@testing-library/react'
import { useUser } from '@company/mfe-react'
import { afterEach, expect, it } from 'vitest'

// A component test with explicit fixtures: no shell process, no live
// credentials, no federation.
let environment: ReturnType<typeof createMfeTestEnvironment> | null = null

afterEach(async () => {
  // Cleared before the await, not after: a second test may have assigned a new
  // environment by the time this one resolves, and clearing then would drop it.
  const current = environment
  environment = null
  await current?.dispose()
})

it('reads the signed-in user from shell state', () => {
  environment = createMfeTestEnvironment({
    definitionId: 'canvas-01',
    shellState: { user: { id: 'u-1', name: 'Ada Lovelace' } },
  })

  const { result } = renderHook(() => useUser(), { wrapper: environment.wrapper })

  expect(result.current?.name).toBe('Ada Lovelace')
})
