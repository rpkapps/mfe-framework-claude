import { afterEach, describe, expect, it, vi } from 'vitest'

import { forgetAvatar, loadAvatar } from './avatar.ts'

const PROFILE = {
  sub: 'a1b2',
  entraid_avatar: 'https://graph.microsoft.com/v1.0/me/photo/$value',
  entraid_access_token: 'graph-token',
}

function memoryCache(): Map<string, string> & Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  const map = new Map<string, string>()
  return Object.assign(map, {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
    removeItem: (key: string) => {
      map.delete(key)
    },
  })
}

function answering(status: number): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>(() =>
    Promise.resolve(new Response(status === 200 ? new Blob(['jpeg']) : null, { status })),
  )
}

const shrink = (): Promise<string> => Promise.resolve('data:image/jpeg;base64,c21hbGw=')

afterEach(() => {
  vi.restoreAllMocks()
})

describe('loadAvatar', () => {
  it('fetches the photo with the Graph token, shrinks it and keeps it for the tab', async () => {
    const fetch = answering(200)
    const cache = memoryCache()

    await expect(loadAvatar(PROFILE, { fetch, cache, shrink })).resolves.toBe(
      'data:image/jpeg;base64,c21hbGw=',
    )
    expect(fetch).toHaveBeenCalledWith(PROFILE.entraid_avatar, {
      headers: { Authorization: 'Bearer graph-token' },
    })
    expect([...cache.values()]).toEqual(['data:image/jpeg;base64,c21hbGw='])
  })

  it('uses the kept photo after a reload, even once the Graph token has expired', async () => {
    const cache = memoryCache()
    await loadAvatar(PROFILE, { fetch: answering(200), cache, shrink })

    const fetch = answering(401)
    await expect(loadAvatar(PROFILE, { fetch, cache, shrink })).resolves.toBe(
      'data:image/jpeg;base64,c21hbGw=',
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps each user’s photo apart, and forgets it on sign-out', async () => {
    const cache = memoryCache()
    await loadAvatar(PROFILE, { fetch: answering(200), cache, shrink })

    const fetch = answering(404)
    await expect(loadAvatar({ ...PROFILE, sub: 'c3d4' }, { fetch, cache, shrink })).resolves.toBe(
      undefined,
    )
    expect(fetch).toHaveBeenCalledOnce()

    forgetAvatar(PROFILE, cache)
    expect(cache.size).toBe(0)
  })

  it('shows initials, quietly, for a user without a photo', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const cache = memoryCache()

    await expect(loadAvatar(PROFILE, { fetch: answering(404), cache, shrink })).resolves.toBe(
      undefined,
    )
    expect(warn).not.toHaveBeenCalled()
    expect(cache.size).toBe(0)
  })

  it('shows initials and says why when Graph refuses the token or cannot be reached', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await expect(loadAvatar(PROFILE, { fetch: answering(401), shrink })).resolves.toBe(undefined)
    expect(warn).toHaveBeenLastCalledWith('[shell] The profile photo did not load: HTTP 401.')

    const offline = vi.fn<typeof fetch>(() => Promise.reject(new TypeError('Failed to fetch')))
    await expect(loadAvatar(PROFILE, { fetch: offline, shrink })).resolves.toBe(undefined)
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('fetches nothing without a photo URL or a token', async () => {
    const fetch = answering(200)
    const { entraid_avatar: _url, ...noUrl } = PROFILE
    const { entraid_access_token: _token, ...noToken } = PROFILE

    await expect(loadAvatar(noUrl, { fetch, shrink })).resolves.toBe(undefined)
    await expect(loadAvatar(noToken, { fetch, shrink })).resolves.toBe(undefined)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('shows initials when the photo cannot be shrunk, without keeping anything', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const cache = memoryCache()
    const createObjectURL = vi.spyOn(URL, 'createObjectURL')

    await expect(
      loadAvatar(PROFILE, {
        fetch: answering(200),
        cache,
        shrink: () => Promise.reject(new Error('The source image could not be decoded.')),
      }),
    ).resolves.toBe(undefined)
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(cache.size).toBe(0)
    expect(warn).toHaveBeenCalledOnce()
  })

  it('sends the Graph token only to Microsoft Graph, and says so once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const fetch = answering(200)

    for (const elsewhere of [
      'https://attacker.example/photo',
      'http://graph.microsoft.com/v1.0/me/photo/$value',
      'https://graph.microsoft.com.attacker.example/v1.0/me/photo/$value',
      'https://graph.microsoft.com:8443/v1.0/me/photo/$value',
      'not a url',
    ]) {
      await expect(
        loadAvatar({ ...PROFILE, entraid_avatar: elsewhere }, { fetch, shrink }),
      ).resolves.toBe(undefined)
    }
    expect(fetch).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledOnce()
  })
})
