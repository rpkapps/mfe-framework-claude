/** Owning the session is the shell's job, not the framework's; a real deployment replaces this file (§10). */

import { createSessionTokenService, type AccessTokenSource } from '@company/mfe-react/host'

/** Self-describing, so a development token that reaches a real resource server is obvious rather than a puzzling 401. */
function issue(): string {
  return `dev.${String(Date.now())}.shell-local-only`
}

/** The token rotates on refresh, so the interceptor's 401 replay carries a different credential than the one rejected. */
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
