import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { parseRuntimeConfig, RUNTIME_CONFIG_FIELDS } from './runtime-config.ts'

const SCRIPT = fileURLToPath(new URL('../../deploy/runtime-config.sh', import.meta.url))

describe('parseRuntimeConfig', () => {
  it('keeps every known field of the right type', () => {
    const raw = {
      oidcAuthority: 'https://login.example.com',
      oidcClientId: 'shell',
      oidcScope: 'openid',
      oidcGroupsClaim: 'roles',
      oidcDisabled: false,
    }
    expect(parseRuntimeConfig(raw)).toEqual({ ok: true, config: raw })
  })

  it('reads an empty object, and null, as nothing set', () => {
    expect(parseRuntimeConfig({})).toEqual({ ok: true, config: {} })
    expect(parseRuntimeConfig({ oidcAuthority: null })).toEqual({ ok: true, config: {} })
  })

  it('refuses a field it does not read, so a misspelling is found', () => {
    const parsed = parseRuntimeConfig({ oidcAuthorty: 'https://login.example.com' })
    expect(parsed.ok).toBe(false)
    expect(!parsed.ok && parsed.problem).toContain('oidcAuthorty')
  })

  it('refuses a value of the wrong type, naming its variable', () => {
    const parsed = parseRuntimeConfig({ oidcDisabled: 'true' })
    expect(parsed.ok).toBe(false)
    expect(!parsed.ok && parsed.problem).toContain('OIDC_DISABLED')
  })

  it.each([null, [], 'config', 3])('refuses %j as a whole', raw => {
    expect(parseRuntimeConfig(raw).ok).toBe(false)
  })
})

describe.skipIf(process.platform === 'win32')('deploy/runtime-config.sh', () => {
  const directories: string[] = []
  afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true })
  })

  function run(env: Record<string, string>): unknown {
    const directory = mkdtempSync(join(tmpdir(), 'shell-runtime-config-'))
    directories.push(directory)
    execFileSync('sh', [SCRIPT, directory], { env: { PATH: process.env['PATH'] ?? '', ...env } })
    return JSON.parse(readFileSync(join(directory, 'runtime-config.json'), 'utf8'))
  }

  it('writes every field from its variable, in a form the shell accepts', () => {
    const env = Object.fromEntries(
      RUNTIME_CONFIG_FIELDS.map(spec => [spec.envVar, spec.type === 'boolean' ? 'true' : 'x']),
    )
    const written = run(env)
    expect(Object.keys(written as object).sort()).toEqual(
      RUNTIME_CONFIG_FIELDS.map(spec => spec.field).sort(),
    )
    expect(parseRuntimeConfig(written).ok).toBe(true)
  })

  it('leaves unset and empty variables out', () => {
    expect(run({ OIDC_CLIENT_ID: '', OIDC_DISABLED: 'false' })).toEqual({ oidcDisabled: false })
    expect(run({})).toEqual({})
  })

  it('escapes whatever a value holds', () => {
    const value = 'a "quoted" \\ value\twith\nlines'
    expect(run({ OIDC_SCOPE: value })).toEqual({ oidcScope: value })
  })

  it('refuses a boolean that is not true or false', () => {
    expect(() => run({ OIDC_DISABLED: 'yes' })).toThrow()
  })
})
