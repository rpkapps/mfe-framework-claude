import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { env, isEnvVarDescriptor } from './env.ts'

describe('env', () => {
  it('returns a declaration, never a value', () => {
    const descriptor = env('API_BASE_URL', z.string().url(), { api: true })

    expect(descriptor).toMatchObject({ kind: 'mfe-env-var', name: 'API_BASE_URL', api: true })
    expect(isEnvVarDescriptor(descriptor)).toBe(true)
    expect(descriptor).not.toHaveProperty('value')
  })

  it('defaults to not declaring an API origin', () => {
    expect(env('OIDC_ISSUER', z.string().url()).api).toBe(false)
  })

  it('keeps the author schema so validation runs through it', () => {
    const descriptor = env('RETRIES', z.number().int().default(3))

    expect(descriptor.schema.safeParse(undefined)).toEqual({ success: true, data: 3 })
    expect(descriptor.schema.safeParse('nope').success).toBe(false)
  })

  it('rejects a variable name a shell could not set', () => {
    expect(() => env('apiBaseUrl', z.string())).toThrow(/upper-case letters/)
  })

  it('rejects a missing schema', () => {
    expect(() => env('API_BASE_URL', undefined as unknown as z.ZodString)).toThrow(/a Zod schema/)
  })
})
