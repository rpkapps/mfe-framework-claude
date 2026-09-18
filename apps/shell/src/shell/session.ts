/**
 * The shell's session.
 *
 * Owning this is the shell's job, not the framework's: a real deployment hands
 * Better Auth, Auth0 or MSAL's own accessor to `installShellAuth` and deletes
 * this file. It exists so the authenticated path from `#mfe/fetch` through the
 * interceptor is actually exercised in the test shell rather than described.
 *
 * `createSessionTokenService` is the framework's optional single-flight
 * adapter, used here because this shell has no auth library to dedupe refreshes
 * for it. It never reads or writes browser storage, so nothing here leaves a
 * token where another origin or a later session could find it.
 */

import { createSessionTokenService, type AccessTokenSource } from '@company/mfe-host'

/**
 * Issued locally and accepted by nothing. A development token is deliberately
 * self-describing, so one that reaches a real resource server is obvious in the
 * request that carries it rather than a puzzling 401.
 */
function issue(): string {
  return `dev.${String(Date.now())}.shell-local-only`
}

/**
 * A development session with no identity provider. The token rotates on
 * refresh, which is what makes the 401-retry path in the interceptor real: a
 * replay carries a different credential from the one the server rejected.
 */
export function createDevSession(): AccessTokenSource {
  let current: string | null = null

  return createSessionTokenService({
    id: 'shell',
    getToken: () => current,
    refreshToken: () => {
      current = issue()
      return current
    },
  })
}
