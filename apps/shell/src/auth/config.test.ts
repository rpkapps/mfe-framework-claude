import { describe, expect, it } from 'vitest'

import { DEFAULT_GROUPS_CLAIM, DEFAULT_SCOPE, resolveAuthConfig } from './config.ts'

const configured = {
  oidcAuthority: 'https://login.example.com/realms/discovery',
  oidcClientId: 'shell',
}

describe('resolveAuthConfig', () => {
  it('signs in with the defaults when the authority and client are set', () => {
    expect(resolveAuthConfig(configured, true)).toEqual({
      kind: 'oidc',
      authority: configured.oidcAuthority,
      clientId: 'shell',
      scope: DEFAULT_SCOPE,
      groupsClaim: DEFAULT_GROUPS_CLAIM,
    })
  })

  it('takes the scope and groups claim when they are set', () => {
    const config = resolveAuthConfig(
      { ...configured, oidcScope: 'openid profile', oidcGroupsClaim: 'roles' },
      false,
    )
    expect(config).toMatchObject({ kind: 'oidc', scope: 'openid profile', groupsClaim: 'roles' })
  })

  it('is off when oidcDisabled is true, even with a provider configured', () => {
    expect(resolveAuthConfig({ ...configured, oidcDisabled: true }, true)).toEqual({
      kind: 'disabled',
      reason: 'explicit',
    })
  })

  it('signs in when oidcDisabled is false', () => {
    expect(resolveAuthConfig({ ...configured, oidcDisabled: false }, true).kind).toBe('oidc')
  })

  it('is off in a development build with nothing configured', () => {
    expect(resolveAuthConfig({}, false)).toEqual({ kind: 'disabled', reason: 'unconfigured' })
  })

  it('fails closed in a production build with nothing configured', () => {
    const config = resolveAuthConfig({ oidcAuthority: ' ', oidcClientId: '' }, true)
    expect(config.kind).toBe('misconfigured')
  })

  it('names the missing half when only one of authority and client is set', () => {
    const config = resolveAuthConfig({ oidcAuthority: configured.oidcAuthority }, false)
    expect(config).toMatchObject({ kind: 'misconfigured' })
    expect(config.kind === 'misconfigured' && config.problem).toContain('OIDC_CLIENT_ID')
  })

  it('accepts plain http for localhost only', () => {
    const local = { oidcAuthority: 'http://localhost:8080/realms/dev', oidcClientId: 'shell' }
    expect(resolveAuthConfig(local, false).kind).toBe('oidc')

    const remote = { oidcAuthority: 'http://login.example.com', oidcClientId: 'shell' }
    expect(resolveAuthConfig(remote, false).kind).toBe('misconfigured')
  })

  it('rejects an authority that is not a URL', () => {
    const config = resolveAuthConfig(
      { oidcAuthority: 'login.example.com', oidcClientId: 'shell' },
      false,
    )
    expect(config.kind).toBe('misconfigured')
  })

  it('rejects a scope without openid', () => {
    const config = resolveAuthConfig({ ...configured, oidcScope: 'profile email' }, true)
    expect(config.kind).toBe('misconfigured')
  })
})
