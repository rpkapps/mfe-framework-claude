import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { isMfeError } from './errors.ts'
import { HOST_SCOPE } from './scope.ts'
import { isStoredKey, storedKey, type MfeStorage, type StoredKey } from './storage.ts'

function declarationError(declare: () => unknown): { code: string; message: string } {
  try {
    declare()
  } catch (error) {
    if (isMfeError(error)) return error
    throw error
  }
  throw new Error('expected the declaration to throw')
}

describe('storedKey', () => {
  it('takes its default from the schema and fills in the options', () => {
    const units = storedKey('units', z.enum(['metric', 'imperial']).default('metric'))

    expect(isStoredKey(units)).toBe(true)
    expect(units).toMatchObject({
      name: 'units',
      defaultValue: 'metric',
      storage: 'local',
      perInstance: false,
      version: 1,
    })
    expect(units.owner).toBeUndefined()
    expect(units.migrate).toBeUndefined()
    expect(Object.isFrozen(units)).toBe(true)
  })

  it('keeps the area, perInstance, version and migrate it is given', () => {
    const migrate = (value: unknown): number => Number(value)
    const zoom = storedKey('zoom', z.number().default(1), {
      storage: 'session',
      perInstance: true,
      version: 3,
      migrate,
    })

    expect(zoom).toMatchObject({ storage: 'session', perInstance: true, version: 3, migrate })
  })

  it('runs the schema default, so a transformed or object default is what a reader sees', () => {
    const filters = storedKey(
      'filters',
      z.object({ well: z.string().nullable(), page: z.number() }).default({ well: null, page: 1 }),
    )

    expect(filters.defaultValue).toEqual({ well: null, page: 1 })
  })

  it('rejects a schema without a default at the call site', () => {
    // @ts-expect-error: a key needs a schema default, so it never reads `undefined`.
    const declare = () => storedKey('units', z.enum(['metric', 'imperial']))

    expect(declarationError(declare)).toMatchObject({
      code: 'storage/invalid-value',
      message: expect.stringMatching(/\.default\(/) as unknown,
    })
  })

  it.each(['', 'a@b', 'a:b'])('rejects the key name %j', name => {
    expect(declarationError(() => storedKey(name, z.string().default('x'))).code).toBe(
      'storage/invalid-value',
    )
  })

  it.each([0, -1, 1.5, Number.NaN])('rejects the version %s', version => {
    expect(
      declarationError(() => storedKey('units', z.string().default('x'), { version })).code,
    ).toBe('storage/invalid-value')
  })
})

describe('storedKey.from', () => {
  it('declares a read-only key of the named owner, with the reader’s own default', () => {
    const labUnits = storedKey.from(
      'lab',
      'units',
      z.enum(['metric', 'imperial']).default('imperial'),
      { storage: 'user' },
    )

    expect(labUnits).toMatchObject({ owner: 'lab', name: 'units', defaultValue: 'imperial' })
    expect(isStoredKey(labUnits)).toBe(true)
  })

  it('accepts the host as an owner', () => {
    expect(storedKey.from(HOST_SCOPE, 'theme', z.string().default('system')).owner).toBe(HOST_SCOPE)
  })

  it.each(['', 'Lab', 'lab:units', 'lab@1', '@other'])('rejects the owner %j', owner => {
    expect(
      declarationError(() => storedKey.from(owner, 'units', z.string().default('x'))).code,
    ).toBe('storage/invalid-value')
  })

  it('has no setter in its type', () => {
    const labUnits = storedKey.from('lab', 'units', z.string().default('metric'), {
      storage: 'user',
    })
    const write = (storage: MfeStorage) => {
      // @ts-expect-error: only the owner writes; a storedKey.from key is read-only.
      void storage.set(labUnits, 'imperial')
      // @ts-expect-error: reset() is a write too.
      void storage.reset(labUnits)
    }

    expect(typeof write).toBe('function')
  })
})

describe('isStoredKey', () => {
  it('recognises only declared keys', () => {
    const lookalike: Partial<StoredKey<string>> = { name: 'units', storage: 'local' }

    expect(isStoredKey(lookalike)).toBe(false)
    expect(isStoredKey(null)).toBe(false)
    expect(isStoredKey('units')).toBe(false)
  })
})
