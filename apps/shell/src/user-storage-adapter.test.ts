import { afterEach, expect, it, vi } from 'vitest'

import { userStorageAdapter } from './user-storage-adapter.ts'

afterEach(() => vi.unstubAllGlobals())

it('loads the whole state without naming the user, and forwards cancellation', async () => {
  const controller = new AbortController()
  const state = { lab: { units: { v: 1, d: 'imperial', revision: 2 } } }
  const fetch = vi.fn(async (url: string, request: RequestInit) => {
    expect(url).toBe('http://localhost:3010/api/user-storage')
    expect(request.method).toBeUndefined()
    expect(request.body).toBeUndefined()
    controller.abort()
    expect(request.signal?.aborted).toBe(true)
    return Response.json(state)
  })
  vi.stubGlobal('fetch', fetch)
  expect(await userStorageAdapter.load(controller.signal)).toEqual(state)
})

it('puts one key of one owner and resolves with the stored row', async () => {
  const signal = new AbortController().signal
  const row = { v: 1, d: 'dark', revision: 3 }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, request: RequestInit) => {
      expect(url).toBe('http://localhost:3010/api/user-storage/%40host/theme')
      expect(request.method).toBe('PUT')
      expect(request.body).toBe(JSON.stringify({ v: 1, d: 'dark' }))
      expect(request.signal).toBe(signal)
      return Response.json(row)
    }),
  )
  expect(await userStorageAdapter.save('@host', 'theme', { v: 1, d: 'dark' }, signal)).toEqual(row)
})

it('deletes a key and resolves with null', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, request: RequestInit) => {
      expect(url).toBe('http://localhost:3010/api/user-storage/well-inspection/brief%40tile-1')
      expect(request.method).toBe('DELETE')
      return Response.json(null)
    }),
  )
  expect(
    await userStorageAdapter.save(
      'well-inspection',
      'brief@tile-1',
      null,
      new AbortController().signal,
    ),
  ).toBeNull()
})

it('rejects with the backend message, or the status when the body is not JSON', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ message: 'Unknown owner "Lab"' }, { status: 400 })),
  )
  await expect(
    userStorageAdapter.save('Lab', 'units', { v: 1, d: 1 }, new AbortController().signal),
  ).rejects.toThrow('Unknown owner "Lab"')
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('Bad gateway', { status: 502 })),
  )
  await expect(userStorageAdapter.load(new AbortController().signal)).rejects.toThrow(
    'Example API returned 502',
  )
})
