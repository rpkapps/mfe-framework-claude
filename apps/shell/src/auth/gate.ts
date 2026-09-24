/**
 * Sign-in runs first, before React, the registry or any container is loaded: the entry chunk
 * decides whether this page may boot at all, so nothing behind sign-in is ever fetched, rendered
 * or executed for someone who has not signed in (§36).
 *
 * Authorization code flow with PKCE. Tokens are held in memory only; the one thing written
 * anywhere is the sign-in request's `state` and PKCE verifier, which must survive the redirect,
 * so it goes to `sessionStorage` and is removed when the callback is handled.
 */

import type { AccessTokenSource } from '@company/mfe-react/host'
import { InMemoryWebStorage, UserManager, WebStorageStateStore, type User } from 'oidc-client-ts'

import { failLoader, setLoaderStatus } from '../loader.ts'
import { identityFromClaims, type ShellIdentity } from './claims.ts'
import { resolveAuthConfig, type OidcConfig } from './config.ts'
import { currentReturnTo, isSigninCallback, safeReturnTo } from './return-to.ts'
import { fetchRuntimeConfig } from './runtime-config.ts'
import { createOidcTokenSource } from './token-source.ts'

export type ShellSession =
  | {
      readonly mode: 'oidc'
      readonly identity: ShellIdentity
      readonly tokens: AccessTokenSource
      readonly signOut: () => Promise<void>
    }
  | {
      readonly mode: 'disabled'
      readonly identity: ShellIdentity
    }

/** Who the shell is when sign-in is off: a development session, never a real account. */
const DEVELOPMENT_IDENTITY: ShellIdentity = {
  user: { id: 'u-2841', name: 'Robin Kolesnik', email: 'robin.kolesnik@example.com' },
  groups: ['geoscience', 'well-planning.read'],
}

let session: ShellSession | null = null

/** The session `authenticate` established; boot reads it, and nothing boots without one. */
export function shellSession(): ShellSession {
  if (session === null) {
    throw new Error('The shell booted before authenticate() established a session.')
  }
  return session
}

/** `sessionStorage` throws outright when storage is blocked; the callback then fails and says so. */
function signinStateStorage(): Storage {
  try {
    return window.sessionStorage
  } catch {
    return new InMemoryWebStorage()
  }
}

function createUserManager(config: OidcConfig): UserManager {
  const home = `${window.location.origin}/`
  return new UserManager({
    authority: config.authority,
    client_id: config.clientId,
    redirect_uri: home,
    post_logout_redirect_uri: home,
    response_type: 'code',
    scope: config.scope,
    disablePKCE: false,
    userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }),
    stateStore: new WebStorageStateStore({ store: signinStateStorage(), prefix: 'shell.oidc.' }),
    // Renewal happens on demand, when a request needs a token, through the refresh token grant.
    automaticSilentRenew: false,
    monitorSession: false,
  })
}

function describe(cause: unknown): string {
  if (cause instanceof Error && cause.message !== '') return cause.message
  return 'The identity provider did not say why.'
}

function redirectToSignIn(manager: UserManager, returnTo: string): void {
  setLoaderStatus('Redirecting to sign in…')
  // `replace`, so Back from the identity provider leaves the shell rather than landing on a page
  // that would only redirect again.
  manager.signinRedirect({ state: returnTo, redirectMethod: 'replace' }).catch((cause: unknown) => {
    failLoader({
      title: 'The sign-in service is unreachable',
      detail: describe(cause),
      actionLabel: 'Try again',
      onAction: () => {
        window.location.reload()
      },
    })
  })
}

function oidcSession(manager: UserManager, config: OidcConfig, user: User): ShellSession {
  const tokens = createOidcTokenSource({
    current: () => manager.getUser(),
    renew: () => manager.signinSilent(),
    // The session cannot continue without a new sign-in, which is a page navigation. Where the
    // user was is kept, so they come back to it.
    onSessionLost: () => {
      void manager.signinRedirect({ state: currentReturnTo(window.location) })
    },
  })
  return {
    mode: 'oidc',
    identity: identityFromClaims(user.profile, config.groupsClaim),
    tokens,
    signOut: () => manager.signoutRedirect(),
  }
}

/**
 * Resolves `true` when the page may boot. Otherwise the page is leaving for the identity
 * provider, or the loader is showing why it cannot continue, and nothing else should load.
 */
export async function authenticate(): Promise<boolean> {
  const runtime = await fetchRuntimeConfig()
  if (!runtime.ok) {
    failLoader({
      title: 'The configuration could not be loaded',
      detail: runtime.problem,
      actionLabel: 'Reload',
      onAction: () => {
        window.location.reload()
      },
    })
    return false
  }

  const production = process.env['NODE_ENV'] === 'production'
  const config = resolveAuthConfig(runtime.config, production)

  if (config.kind === 'misconfigured') {
    failLoader({ title: 'Sign-in is not configured', detail: config.problem })
    return false
  }

  if (config.kind === 'disabled') {
    if (config.reason === 'explicit' && production) {
      console.warn(
        '[shell] Sign-in is disabled by OIDC_DISABLED=true: every visitor is the development user.',
      )
    }
    session = { mode: 'disabled', identity: DEVELOPMENT_IDENTITY }
    return true
  }

  const manager = createUserManager(config)
  const url = new URL(window.location.href)

  // Tokens live in memory, so a page that is not the callback has none and goes straight to the
  // provider, which returns at once while its own session lasts.
  if (!isSigninCallback(url)) {
    redirectToSignIn(manager, currentReturnTo(window.location))
    return false
  }

  setLoaderStatus('Signing you in…')
  try {
    const user = await manager.signinCallback(url.href)
    if (user === undefined) throw new Error('The sign-in response did not produce a session.')
    session = oidcSession(manager, config, user)
    // The code and state leave the address bar before any router reads it.
    window.history.replaceState(null, '', safeReturnTo(user.state, window.location.origin))
    // Requests abandoned mid-flight, from earlier tabs or visits, are cleaned up here.
    void manager.clearStaleState()
    return true
  } catch (cause) {
    window.history.replaceState(null, '', '/')
    failLoader({
      title: 'We could not sign you in',
      detail: describe(cause),
      actionLabel: 'Sign in again',
      onAction: () => {
        redirectToSignIn(manager, '/')
      },
    })
    return false
  }
}
