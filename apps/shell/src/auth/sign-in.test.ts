// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Failure } from '../failure/failure-page.tsx'
import { signInAfterSessionLost } from './sign-in.ts'
import { createOidcTokenSource } from './token-source.ts'

const doubles = vi.hoisted(() => ({
  failLoader: vi.fn<(failure: Failure) => void>(),
  showFailure: vi.fn<(failure: Failure) => void>(),
}))

vi.mock('../loader.ts', () => ({
  LOADER_ID: 'shell-loader',
  failLoader: doubles.failLoader,
  setLoaderStatus: vi.fn(),
}))

vi.mock('../failure/show.tsx', () => ({ showFailure: doubles.showFailure }))

const { failLoader, showFailure } = doubles

/** The part of the `oidc-client-ts` user manager that ending a session and signing in use. */
function userManager() {
  return {
    removeUser: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    signinRedirect: vi.fn<(args: unknown) => Promise<void>>(() => Promise.resolve()),
  }
}

describe('signInAfterSessionLost', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/wells/42?tab=logs#top')
    delete document.documentElement.dataset['shell']
    document.body.innerHTML = '<div id="shell-loader" data-state="loading"></div>'
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('ends the session when renewal fails and signs in again, back to where the user was', async () => {
    const manager = userManager()
    // As gate.ts wires it.
    const tokens = createOidcTokenSource({
      current: () => Promise.resolve({ access_token: 'a' }),
      renew: () => Promise.reject(new Error('invalid_grant')),
      onSessionLost: () => {
        signInAfterSessionLost(manager)
      },
    })
    await expect(tokens.getAccessToken({ rejectedToken: 'a' })).resolves.toBeNull()

    await vi.waitFor(() => {
      expect(manager.signinRedirect).toHaveBeenCalledWith({
        state: '/wells/42?tab=logs#top',
        // So Back from the identity provider does not land on a page that redirects again.
        redirectMethod: 'replace',
      })
    })
    expect(manager.removeUser.mock.invocationCallOrder[0]).toBeLessThan(
      manager.signinRedirect.mock.invocationCallOrder[0] ?? 0,
    )
    expect(failLoader).not.toHaveBeenCalled()
    expect(showFailure).not.toHaveBeenCalled()
  })

  it('signs in again when the old session could not be removed', async () => {
    const manager = userManager()
    manager.removeUser.mockRejectedValue(new Error('The storage is blocked.'))
    signInAfterSessionLost(manager)
    await vi.waitFor(() => {
      expect(manager.signinRedirect).toHaveBeenCalledTimes(1)
    })
  })

  it('says the sign-in service is unreachable while the loader is still up', async () => {
    const manager = userManager()
    manager.signinRedirect.mockRejectedValue(new TypeError('Failed to fetch'))
    signInAfterSessionLost(manager)

    await vi.waitFor(() => {
      expect(failLoader).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'unreachable',
          detail: 'Failed to fetch',
          actionLabel: 'Try again',
        }),
      )
    })
    expect(showFailure).not.toHaveBeenCalled()
  })

  it('puts the failure page over a shell that is already in', async () => {
    document.documentElement.dataset['shell'] = 'ready'
    document.body.innerHTML = ''
    const manager = userManager()
    manager.signinRedirect.mockRejectedValue(new TypeError('Failed to fetch'))
    signInAfterSessionLost(manager)

    await vi.waitFor(() => {
      expect(showFailure).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'unreachable', detail: 'Failed to fetch' }),
      )
    })
    // The loader leaves a shell that is in alone, so it is not the one asked.
    expect(failLoader).not.toHaveBeenCalled()
  })

  it('puts the failure page over a shell held back only for the loader to finish', async () => {
    document.body.innerHTML = '<div id="shell-loader" data-state="holding"></div>'
    const manager = userManager()
    manager.signinRedirect.mockRejectedValue(new TypeError('Failed to fetch'))
    signInAfterSessionLost(manager)

    await vi.waitFor(() => {
      expect(showFailure).toHaveBeenCalledTimes(1)
    })
    expect(failLoader).not.toHaveBeenCalled()
  })
})
