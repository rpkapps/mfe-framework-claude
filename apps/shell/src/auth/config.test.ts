import type { MfeConfig } from '#mfe/config'
import { describe, expect, it } from 'vitest'

import { resolveAuthConfig } from './config.ts'

/** What `#mfe/config` holds with nothing set: the defaults src/mfe.config.ts declares. */
const UNSET: MfeConfig = {
  oidcAuthority: undefined,
  oidcClientId: undefined,
  oidcScope: 'openid profile email offline_access',
  oidcGroupsClaim: 'groups',
  oidcDisabled: undefined,
  loader: 'drill-bit',
  loaderMinDuration: { 'drill-bit': 1000 },
}

function config(values: Partial<MfeConfig>): MfeConfig {
  return { ...UNSET, ...values }
}

const configured = config({
  oidcAuthority: 'https://login.example.com/realms/discovery',
  oidcClientId: 'shell',
})

describe('resolveAuthConfig', () => {
  it('signs in with the declared scope and groups claim', () => {
    expect(resolveAuthConfig(configured, true)).toEqual({
      kind: 'oidc',
      authority: 'https://login.example.com/realms/discovery',
      clientId: 'shell',
      scope: 'openid profile email offline_access',
      groupsClaim: 'groups',
    })
  })

  it('takes the scope and groups claim the deployment sets', () => {
    const resolved = resolveAuthConfig(
      { ...configured, oidcScope: 'openid profile', oidcGroupsClaim: 'roles' },
      false,
    )
    expect(resolved).toMatchObject({ kind: 'oidc', scope: 'openid profile', groupsClaim: 'roles' })
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
    expect(resolveAuthConfig(UNSET, false)).toEqual({ kind: 'disabled', reason: 'unconfigured' })
  })

  it('fails closed in a production build with nothing configured', () => {
    expect(resolveAuthConfig(UNSET, true).kind).toBe('misconfigured')
  })

  it('names the missing half when only one of authority and client is set', () => {
    const resolved = resolveAuthConfig(config({ oidcAuthority: configured.oidcAuthority }), false)
    expect(resolved).toMatchObject({ kind: 'misconfigured' })
    expect(resolved.kind === 'misconfigured' && resolved.problem).toContain('OIDC_CLIENT_ID')
  })

  it('accepts plain http for localhost only', () => {
    const local = config({
      oidcAuthority: 'http://localhost:8080/realms/dev',
      oidcClientId: 'shell',
    })
    expect(resolveAuthConfig(local, false).kind).toBe('oidc')

    const remote = config({ oidcAuthority: 'http://login.example.com', oidcClientId: 'shell' })
    expect(resolveAuthConfig(remote, false).kind).toBe('misconfigured')
  })

  it('rejects a scope without openid', () => {
    expect(resolveAuthConfig({ ...configured, oidcScope: 'profile email' }, true).kind).toBe(
      'misconfigured',
    )
  })
})
