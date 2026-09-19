/**
 * The seam between the shell's session and a container's generated
 * `#mfe/fetch`.
 *
 * A generated module is evaluated by the federation runtime with no host in
 * scope, so it cannot be handed a token source as an argument. The shell
 * installs one here at boot and every container resolves it by import.
 *
 * One session for the whole page is the requirement, not a shortcut: §10.5
 * makes refresh single-flight across mounts, so a per-mount source would be the
 * bug. What stays per-container is the part that is genuinely the author's —
 * the API base URL and the origins declared `{ api: true }` — which is why the
 * container passes a binding rather than receiving a ready transport.
 */

import { createMfeError, type DiagnosticsHub } from '@company/mfe-core'

import {
  createAuthTransport,
  type AccessTokenSource,
  type AuthTransport,
  type FetchLike,
} from './authenticated-fetch.ts'

/** What the shell owns: the session, and how failures are surfaced. */
export interface ShellAuthOptions {
  readonly tokens: AccessTokenSource
  readonly diagnostics?: DiagnosticsHub
  /** Gates developer-only warnings that would be noise in production. */
  readonly isDevelopment?: boolean
  /** The `fetch` to wrap. Defaults to the browser's, read at call time. */
  readonly fetch?: FetchLike
}

/** What the container's build knows and the shell cannot. */
export interface ContainerAuthBinding {
  /** The container's definition id, used for attribution in diagnostics. */
  readonly id: string
  /** The default base for relative request URLs: the first declared API. */
  readonly apiBaseUrl?: string | URL
  /** Every origin declared `{ api: true }`. Only these receive the token. */
  readonly apiOrigins: Iterable<string | URL>
}

let installed: ShellAuthOptions | null = null

/**
 * Installs the shell's session. Returns an uninstall so a test — or a shell
 * that re-authenticates into a different session — can replace it without
 * leaving the previous one reachable.
 */
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

/**
 * The transport behind a container's generated `#mfe/fetch`.
 *
 * Resolution is deferred to the first call rather than done here: the module
 * that calls this is evaluated during container load, and making that
 * evaluation depend on shell boot order would turn a wiring mistake into an
 * unloadable container instead of an actionable error on the request itself.
 */
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

  // Both are `async` so a missing session rejects rather than throwing
  // synchronously: callers of a `fetch`-shaped function handle rejections.
  return {
    fetch: async (input, init) => await transport().fetch(input, init),
    getAccessToken: async options => await transport().getAccessToken(options),
  }
}
