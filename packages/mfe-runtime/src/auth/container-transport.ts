/**
 * The seam between the shell's session and a container's generated `#mfe/fetch`, which the
 * federation runtime evaluates with no host in scope. One session serves the whole page,
 * because a per-mount token source would be the bug (§10).
 */

import { createMfeError } from '@company/mfe-core'

import type { DiagnosticsHub } from '../diagnostics.ts'
import {
  createAuthTransport,
  type AccessTokenSource,
  type AuthTransport,
  type FetchLike,
} from './authenticated-fetch.ts'

export interface ShellAuthOptions {
  readonly tokens: AccessTokenSource
  readonly diagnostics?: DiagnosticsHub
  /** Gates developer-only warnings that would be noise in production. */
  readonly isDevelopment?: boolean
  /** Defaults to the browser's `fetch`, read at call time. */
  readonly fetch?: FetchLike
}

export interface ContainerAuthBinding {
  /** The container's definition id, used for attribution in diagnostics. */
  readonly id: string
  /** The default base for relative request URLs: the first declared API. */
  readonly apiBaseUrl?: string | URL
  /** Every origin declared `{ api: true }`; only these receive the token. */
  readonly apiOrigins: Iterable<string | URL>
}

let installed: ShellAuthOptions | null = null

/** Returns an uninstall, so a replacement never leaves the previous session reachable. */
export function installShellAuth(options: ShellAuthOptions): () => void {
  installed = options
  return () => {
    if (installed === options) installed = null
  }
}

function requireShellAuth(binding: ContainerAuthBinding): ShellAuthOptions {
  if (installed !== null) return installed

  throw createMfeError({
    code: 'config/invalid',
    id: binding.id,
    operation: 'attach the session to a request from #mfe/fetch',
    expected: 'a shell that installed its session before mounting a container',
    observed: 'no installed session',
    repair:
      'Call installShellAuth({ tokens }) during shell boot, before the registry is loaded. `tokens` is whatever the shell already authenticates with — Better Auth, Auth0, MSAL — or createSessionTokenService() when it has no library of its own.',
  })
}

/** Resolved on the first call, so a wiring mistake is an error on that request, not on load. */
export function createContainerTransport(binding: ContainerAuthBinding): AuthTransport {
  let resolved: AuthTransport | null = null

  const transport = (): AuthTransport => {
    if (resolved !== null) return resolved
    const shell = requireShellAuth(binding)
    resolved = createAuthTransport({
      id: binding.id,
      allowedOrigins: binding.apiOrigins,
      tokens: shell.tokens,
      ...(binding.apiBaseUrl === undefined ? {} : { apiBaseUrl: binding.apiBaseUrl }),
      ...(shell.diagnostics === undefined ? {} : { diagnostics: shell.diagnostics }),
      ...(shell.isDevelopment === undefined ? {} : { isDevelopment: shell.isDevelopment }),
      ...(shell.fetch === undefined ? {} : { fetch: shell.fetch }),
    })
    return resolved
  }

  // Both are `async` so a missing session rejects rather than throwing synchronously.
  return {
    fetch: async (input, init) => await transport().fetch(input, init),
    getAccessToken: async options => await transport().getAccessToken(options),
  }
}
