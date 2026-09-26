/**
 * Leaving for the identity provider, and saying so when it cannot be reached: when the page has no
 * session, from the failure page's "Sign in again", and when a session is lost (§36). Apart from
 * `gate.ts`, which reads the runtime configuration, so that it runs under test.
 */

import type { UserManager } from 'oidc-client-ts'

import type { Failure } from '../failure/failure-page.tsx'
import { failLoader, LOADER_ID, setLoaderStatus } from '../loader.ts'
import { currentReturnTo } from './return-to.ts'

export function describeCause(cause: unknown): string {
  if (cause instanceof Error && cause.message !== '') return cause.message
  return 'The identity provider did not say why.'
}

/**
 * Until the shell is on its way in, a failure is the loader's to show. After that, the one failure
 * shown from here is a lost session that could not reach sign-in, and a shell without a token can
 * do nothing, so the failure page goes over it rather than leaving it silently signed out.
 */
function showSignInFailure(failure: Failure): void {
  const loader = document.getElementById(LOADER_ID)
  const shellOnItsWay =
    document.documentElement.dataset['shell'] === 'ready' || loader?.dataset['state'] === 'holding'
  if (!shellOnItsWay) {
    failLoader(failure)
    return
  }
  import('../failure/show.tsx').then(
    ({ showFailure }) => {
      showFailure(failure)
    },
    (cause: unknown) => {
      console.error(`[shell] ${failure.title}, and the failure page could not load.`, cause)
    },
  )
}

/**
 * Also the failure page's "Sign in again", after the loader is gone: its button then says it is
 * redirecting, and a provider that cannot be reached replaces the page's failure with its own.
 */
export function redirectToSignIn(
  manager: Pick<UserManager, 'signinRedirect'>,
  returnTo: string,
): void {
  setLoaderStatus('Redirecting to sign in…')
  // `replace`, so Back from the identity provider leaves the shell rather than landing on a page
  // that would only redirect again.
  manager.signinRedirect({ state: returnTo, redirectMethod: 'replace' }).catch((cause: unknown) => {
    showSignInFailure({
      kind: 'unreachable',
      title: 'The sign-in service is unreachable',
      detail: describeCause(cause),
      actionLabel: 'Try again',
      pendingLabel: 'Reloading…',
      onAction: () => {
        window.location.reload()
      },
    })
  })
}

/**
 * The session cannot continue without a new sign-in, which is a page navigation. Where the user
 * was is kept, so they come back to it. When the provider cannot be reached, trying again reloads
 * into a new sign-in, since the session is gone by then.
 */
export function signInAfterSessionLost(
  manager: Pick<UserManager, 'removeUser' | 'signinRedirect'>,
): void {
  const signIn = (): void => {
    redirectToSignIn(manager, currentReturnTo(window.location))
  }
  // Signing in again replaces the old session whether or not it could be removed.
  manager.removeUser().then(signIn, signIn)
}
