import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createContainerTransport,
  installShellAuth,
  type ContainerAuthBinding,
} from './container-transport.ts'
import type { FetchLike } from './authenticated-fetch.ts'

const API = 'https://api.example.test'
const REPORTS = 'https://reports.example.test'
const THIRD_PARTY = 'https://analytics.vendor.test'

const BINDING: ContainerAuthBinding = {
  id: 'operations',
  apiBaseUrl: `${API}/v1/`,
  apiOrigins: [API, REPORTS],
}

let uninstall: (() => void) | null = null

afterEach(() => {
  uninstall?.()
  uninstall = null
})

interface Installed {
  readonly calls: { url: string; authorization: string | null }[]
  readonly getAccessToken: ReturnType<typeof vi.fn>
}

function installSession(token: string | null = 'token-1'): Installed {
  const calls: { url: string; authorization: string | null }[] = []
  const fetch: FetchLike = (input, init) => {
    calls.push({
      url: input instanceof Request ? input.url : String(input),
      authorization: new Headers(init?.headers).get('Authorization'),
    })
    return Promise.resolve(new Response('{}', { status: 200 }))
  }

  const getAccessToken = vi.fn(() => Promise.resolve(token))
  uninstall = installShellAuth({ tokens: { getAccessToken }, fetch })
  return { calls, getAccessToken }
}

describe('createContainerTransport: the shell owns the session', () => {
  it('attaches the installed session token to a declared origin', async () => {
    const session = installSession()

    await createContainerTransport(BINDING).fetch('/assets')

    expect(session.calls).toEqual([{ url: `${API}/assets`, authorization: 'Bearer token-1' }])
  })

  it('resolves a relative URL against the first declared API, not the document', async () => {
    const session = installSession()

    await createContainerTransport(BINDING).fetch('assets')

    expect(session.calls[0]?.url).toBe(`${API}/v1/assets`)
  })

  it('sends an undeclared origin without the token rather than leaking it', async () => {
    const session = installSession()

    await createContainerTransport(BINDING).fetch(`${THIRD_PARTY}/collect`)

    expect(session.calls[0]?.authorization).toBeNull()
  })

  it('hands the tier-2 accessor the same session', async () => {
    installSession('token-1')

    await expect(createContainerTransport(BINDING).getAccessToken()).resolves.toBe('token-1')
  })

  it('gives every container the one installed session', async () => {
    const session = installSession()
    const reports: ContainerAuthBinding = { id: 'reports', apiOrigins: [REPORTS] }

    await createContainerTransport(BINDING).fetch('/assets')
    await createContainerTransport(reports).fetch(`${REPORTS}/summary`)

    expect(session.getAccessToken).toHaveBeenCalledTimes(2)
    expect(session.calls.map(call => call.authorization)).toEqual([
      'Bearer token-1',
      'Bearer token-1',
    ])
  })
})

describe('createContainerTransport: binding before the shell installed a session', () => {
  it('binds without a session and picks up the one installed afterwards', async () => {
    const transport = createContainerTransport(BINDING)
    const session = installSession()

    await transport.fetch('/assets')

    expect(session.calls[0]?.authorization).toBe('Bearer token-1')
  })

  it('rejects with an actionable error when the shell never installed one', async () => {
    const transport = createContainerTransport(BINDING)

    await expect(transport.fetch('/assets')).rejects.toThrowError(/installShellAuth/)
    await expect(transport.getAccessToken()).rejects.toThrowError(
      /operations failed to attach the session/,
    )
  })

  it('stops resolving a session that was uninstalled', async () => {
    installSession()
    uninstall?.()
    uninstall = null

    await expect(createContainerTransport(BINDING).fetch('/assets')).rejects.toThrowError(
      /no installed session/,
    )
  })
})

describe('createContainerTransport: one session per page, whatever copy reads it', () => {
  it('reaches the session the shell installed through its own copy', async () => {
    const session = installSession()
    vi.resetModules()
    const other = await import('./container-transport.ts')
    expect(other.createContainerTransport).not.toBe(createContainerTransport)

    await other.createContainerTransport(BINDING).fetch('/assets')

    expect(session.calls).toEqual([{ url: `${API}/assets`, authorization: 'Bearer token-1' }])
  })

  it('leaves a newer session installed when the previous one is uninstalled', async () => {
    const previous = installShellAuth({ tokens: { getAccessToken: () => Promise.resolve('old') } })
    const newer = installSession('new')

    previous()

    await createContainerTransport(BINDING).fetch('/assets')
    expect(newer.calls[0]?.authorization).toBe('Bearer new')
  })
})
