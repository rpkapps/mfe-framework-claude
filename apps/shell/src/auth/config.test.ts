import { describe, expect, it } from 'vitest'

import { DEFAULT_GROUPS_CLAIM, DEFAULT_SCOPE, resolveAuthConfig } from './config.ts'

const configured = {
  OIDC_AUTHORITY: 'https://login.example.com/realms/discovery',
  OIDC_CLIENT_ID: 'shell',
}

describe('resolveAuthConfig', () => {
  it('signs in with the defaults when the authority and client are set', () => {
    expect(resolveAuthConfig({ ...configured, production: true })).toEqual({
      kind: 'oidc',
      authority: configured.OIDC_AUTHORITY,
      clientId: 'shell',
      scope: DEFAULT_SCOPE,
      groupsClaim: DEFAULT_GROUPS_CLAIM,
    })
  })

  it('takes the scope and groups claim when they are set', () => {
    const config = resolveAuthConfig({
      ...configured,
      OIDC_SCOPE: 'openid profile',
      OIDC_GROUPS_CLAIM: 'roles',
      production: false,
    })
    expect(config).toMatchObject({ kind: 'oidc', scope: 'openid profile', groupsClaim: 'roles' })
  })

  it('is off when OIDC_DISABLED is true, even with a provider configured', () => {
    expect(resolveAuthConfig({ ...configured, OIDC_DISABLED: 'true', production: true })).toEqual({
      kind: 'disabled',
      reason: 'explicit',
    })
  })

  it('is off in a development build with nothing configured', () => {
    expect(resolveAuthConfig({ production: false })).toEqual({
      kind: 'disabled',
      reason: 'unconfigured',
    })
  })

  it('fails closed in a production build with nothing configured', () => {
    const config = resolveAuthConfig({ OIDC_AUTHORITY: ' ', OIDC_CLIENT_ID: '', production: true })
    expect(config.kind).toBe('misconfigured')
  })

  it('treats any other OIDC_DISABLED value as not disabled', () => {
    expect(resolveAuthConfig({ OIDC_DISABLED: 'yes', production: true }).kind).toBe('misconfigured')
  })

  it('names the missing half when only one of authority and client is set', () => {
    const config = resolveAuthConfig({
      OIDC_AUTHORITY: configured.OIDC_AUTHORITY,
      production: false,
    })
    expect(config).toMatchObject({ kind: 'misconfigured' })
    expect(config.kind === 'misconfigured' && config.problem).toContain('OIDC_CLIENT_ID')
  })

  it('accepts plain http for localhost only', () => {
    const local = resolveAuthConfig({
      OIDC_AUTHORITY: 'http://localhost:8080/realms/dev',
      OIDC_CLIENT_ID: 'shell',
      production: false,
    })
    expect(local.kind).toBe('oidc')

    const remote = resolveAuthConfig({
      OIDC_AUTHORITY: 'http://login.example.com',
      OIDC_CLIENT_ID: 'shell',
      production: false,
    })
    expect(remote.kind).toBe('misconfigured')
  })

  it('rejects an authority that is not a URL', () => {
    const config = resolveAuthConfig({
      OIDC_AUTHORITY: 'login.example.com',
      OIDC_CLIENT_ID: 'shell',
      production: false,
    })
    expect(config.kind).toBe('misconfigured')
  })

  it('rejects a scope without openid', () => {
    const config = resolveAuthConfig({
      ...configured,
      OIDC_SCOPE: 'profile email',
      production: true,
    })
    expect(config.kind).toBe('misconfigured')
  })
})
