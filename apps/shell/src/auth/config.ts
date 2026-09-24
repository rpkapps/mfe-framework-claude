/**
 * What the build says about sign-in, decided once and before anything renders. Pure, so every
 * combination is a unit test rather than a deployment that found out (§36).
 */

/** Read from the build's environment by `readAuthEnvironment` in `gate.ts`. */
export interface AuthEnvironment {
  readonly OIDC_AUTHORITY?: string | undefined
  readonly OIDC_CLIENT_ID?: string | undefined
  readonly OIDC_SCOPE?: string | undefined
  readonly OIDC_GROUPS_CLAIM?: string | undefined
  readonly OIDC_DISABLED?: string | undefined
  /** A production build fails closed: sign-in off must be written down, never inferred. */
  readonly production: boolean
}

export interface OidcConfig {
  readonly kind: 'oidc'
  readonly authority: string
  readonly clientId: string
  readonly scope: string
  readonly groupsClaim: string
}

export type AuthConfig =
  | OidcConfig
  /** `explicit` is `OIDC_DISABLED=true`; `unconfigured` is a development build with nothing set. */
  | { readonly kind: 'disabled'; readonly reason: 'explicit' | 'unconfigured' }
  | { readonly kind: 'misconfigured'; readonly problem: string }

/** `offline_access` asks for a refresh token, so renewal never needs a round trip through the page. */
export const DEFAULT_SCOPE = 'openid profile email offline_access'
export const DEFAULT_GROUPS_CLAIM = 'groups'

function setting(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed === '' ? undefined : trimmed
}

/** Plain http is for an identity provider on this machine, never one across a network. */
function isAcceptableAuthority(authority: string): boolean {
  let url: URL
  try {
    url = new URL(authority)
  } catch {
    return false
  }
  if (url.protocol === 'https:') return true
  return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
}

export function resolveAuthConfig(env: AuthEnvironment): AuthConfig {
  if (setting(env.OIDC_DISABLED) === 'true') return { kind: 'disabled', reason: 'explicit' }

  const authority = setting(env.OIDC_AUTHORITY)
  const clientId = setting(env.OIDC_CLIENT_ID)

  if (authority === undefined && clientId === undefined) {
    if (!env.production) return { kind: 'disabled', reason: 'unconfigured' }
    return {
      kind: 'misconfigured',
      problem:
        'This build has no identity provider. Set OIDC_AUTHORITY and OIDC_CLIENT_ID, or OIDC_DISABLED=true to run without sign-in.',
    }
  }
  if (authority === undefined || clientId === undefined) {
    return {
      kind: 'misconfigured',
      problem: `OIDC_${authority === undefined ? 'AUTHORITY' : 'CLIENT_ID'} is missing. Sign-in needs both OIDC_AUTHORITY and OIDC_CLIENT_ID.`,
    }
  }
  if (!isAcceptableAuthority(authority)) {
    return {
      kind: 'misconfigured',
      problem: `OIDC_AUTHORITY '${authority}' is not an https URL (plain http is accepted for localhost only).`,
    }
  }

  const scope = setting(env.OIDC_SCOPE) ?? DEFAULT_SCOPE
  if (!scope.split(/\s+/).includes('openid')) {
    return {
      kind: 'misconfigured',
      problem: `OIDC_SCOPE '${scope}' does not include 'openid', so the provider would not return an ID token.`,
    }
  }

  return {
    kind: 'oidc',
    authority,
    clientId,
    scope,
    groupsClaim: setting(env.OIDC_GROUPS_CLAIM) ?? DEFAULT_GROUPS_CLAIM,
  }
}
