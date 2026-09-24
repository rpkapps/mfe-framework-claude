/**
 * What the deployment's runtime configuration says about sign-in, decided once and before
 * anything renders. Pure, so every combination is a unit test rather than a deployment that found
 * out (§36). The problems name the environment variables, because that is what an operator sets.
 */

import type { MfeConfig } from '#mfe/config'

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

/** `production` fails closed: sign-in off must be written down, never inferred. */
export function resolveAuthConfig(config: MfeConfig, production: boolean): AuthConfig {
  if (config.oidcDisabled === true) return { kind: 'disabled', reason: 'explicit' }

  const authority = setting(config.oidcAuthority)
  const clientId = setting(config.oidcClientId)

  if (authority === undefined && clientId === undefined) {
    if (!production) return { kind: 'disabled', reason: 'unconfigured' }
    return {
      kind: 'misconfigured',
      problem:
        'This deployment has no identity provider. Set OIDC_AUTHORITY and OIDC_CLIENT_ID, or OIDC_DISABLED=true to run without sign-in.',
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

  // Defaulted, trimmed and non-empty by its declaration in src/mfe.config.ts.
  const scope = config.oidcScope
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
    groupsClaim: config.oidcGroupsClaim,
  }
}
