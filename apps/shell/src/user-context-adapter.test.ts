import { afterEach, expect, it, vi } from 'vitest'
import { userContextAdapter } from './user-context-adapter.ts'

afterEach(() => vi.unstubAllGlobals())

it.each([
  { status: 400, code: 'unauthorized-owner' },
  { status: 409, code: 'conflict' },
])('preserves the backend $code failure', async ({ status, code }) => {
  const operation = {
    id: 'well-inspection',
    expectedRevision: 0,
    operationId: 'forbidden',
    value: { brief: null },
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, request: RequestInit) => {
      expect(url).toBe('http://localhost:3010/api/user-context/write/well-inspection')
      expect(request.body).toBe(JSON.stringify(operation))
      return Response.json(
        { code: `user-context/${code}`, id: 'well-inspection', message: 'Rejected' },
        { status },
      )
    }),
  )
  await expect(
    userContextAdapter.write(operation, new AbortController().signal),
  ).rejects.toMatchObject({
    code: `user-context/${code}`,
    id: 'well-inspection',
  })
})

it('hydrates only owner IDs and forwards cancellation to the authenticated API', async () => {
  const signal = new AbortController().signal
  const records = [{ id: 'lab', revision: 0 }]
  const fetch = vi.fn(async (url: string, request: RequestInit) => {
    expect(url).toBe('http://localhost:3010/api/user-context/hydrate')
    expect(request.body).toBe(JSON.stringify({ ids: ['lab'] }))
    expect(request.signal).toBe(signal)
    return Response.json(records)
  })
  vi.stubGlobal('fetch', fetch)
  expect(await userContextAdapter.hydrate(['lab'], signal)).toEqual(records)
})
