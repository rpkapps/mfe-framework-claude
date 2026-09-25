/**
 * Sign-in runs first, before React, the registry or any container is loaded: the entry chunk
 * decides whether this page may boot at all, so nothing behind sign-in is ever fetched, rendered
 * or executed for someone who has not signed in (§36).
 *
 * Authorization code flow with PKCE. The session is kept in `sessionStorage`, so a reload restores
 * it without a round trip through the provider, and it dies with the tab. The sign-in request's
 * `state` and PKCE verifier sit beside it until the callback removes them. A duplicated tab, which
 * arrives holding a copy of the original's tokens, drops them and signs in for itself.
 */

import type { MfeConfig } from '#mfe/config'
import type { AccessTokenSource } from '@company/mfe-react/host'
import { InMemoryWebStorage, UserManager, WebStorageStateStore, type User } from 'oidc-client-ts'

import { failLoader, setLoaderStatus } from '../loader.ts'
import { identityFromClaims, type ShellIdentity } from './claims.ts'
import { resolveAuthConfig, type OidcConfig } from './config.ts'
import { currentReturnTo, isSigninCallback, safeReturnTo } from './return-to.ts'
import { claimTab, type TabClaim, type TabLocks } from './tab.ts'
import { createOidcTokenSource, DEFAULT_SKEW_SECONDS } from './token-source.ts'

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

/**
 * `sessionStorage` throws outright when storage is blocked: the session then lives in memory, and
 * a sign-in callback, which needs the request's state, fails and says so.
 */
function sessionStorageOrMemory(): Storage {
  try {
    return window.sessionStorage
  } catch {
    return new InMemoryWebStorage()
  }
}

function createUserManager(config: OidcConfig, storage: Storage): UserManager {
  const home = `${window.location.origin}/`
  return new UserManager({
    authority: config.authority,
    client_id: config.clientId,
    redirect_uri: home,
    post_logout_redirect_uri: home,
    response_type: 'code',
    scope: config.scope,
    disablePKCE: false,
    // Apart, because clearing stale sign-in requests removes every key under the request store's
    // prefix that does not read as one.
    userStore: new WebStorageStateStore({ store: storage, prefix: 'shell.oidc.session.' }),
    stateStore: new WebStorageStateStore({ store: storage, prefix: 'shell.oidc.request.' }),
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
      kind: 'unreachable',
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
      void manager
        .removeUser()
        .finally(() => manager.signinRedirect({ state: currentReturnTo(window.location) }))
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
 * The session this tab already has, renewed through the refresh token when it is about to expire,
 * or nothing, in which case the page signs in. A copied tab's session is never used.
 */
async function restoreSession(manager: UserManager, tab: TabClaim): Promise<User | null> {
  if (tab === 'copy') {
    await manager.removeUser()
    return null
  }
  const user = await manager.getUser()
  if (user === null) return null
  if ((user.expires_in ?? Infinity) > DEFAULT_SKEW_SECONDS) return user
  if (user.refresh_token === undefined) {
    await manager.removeUser()
    return null
  }
  setLoaderStatus('Restoring your session…')
  try {
    return await manager.signinSilent()
  } catch {
    // An expired or revoked refresh token is an ordinary end of session, not an error to show.
    await manager.removeUser()
    return null
  }
}

/**
 * Resolves `true` when the page may boot. Otherwise the page is leaving for the identity
 * provider, or the loader is showing why it cannot continue, and nothing else should load.
 */
export async function authenticate(): Promise<boolean> {
  let runtime: MfeConfig
  try {
    // Eager, so it is bundled here rather than fetched as a chunk of its own; the module's
    // top-level await loads and validates runtime-config.json, which index.html preloads.
    runtime = (await import(/* webpackMode: "eager" */ '#mfe/config')).config
  } catch (cause) {
    failLoader({
      kind: 'configuration',
      title: 'The configuration could not be loaded',
      detail: describe(cause),
      actionLabel: 'Reload',
      onAction: () => {
        window.location.reload()
      },
    })
    return false
  }

  const production = process.env['NODE_ENV'] === 'production'
  const config = resolveAuthConfig(runtime, production)

  if (config.kind === 'misconfigured') {
    failLoader({
      kind: 'configuration',
      title: 'Sign-in is not configured',
      detail: config.problem,
    })
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

  const storage = sessionStorageOrMemory()
  const manager = createUserManager(config, storage)
  const url = new URL(window.location.href)
  const locks = (navigator as { locks?: TabLocks }).locks
  const tab = await claimTab(storage, locks)

  if (!isSigninCallback(url)) {
    const restored = await restoreSession(manager, tab)
    if (restored !== null) {
      session = oidcSession(manager, config, restored)
      return true
    }
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
      kind: 'sign-in',
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
