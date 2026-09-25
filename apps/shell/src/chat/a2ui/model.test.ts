import { describe, expect, it } from 'vitest'

import {
  absolutePath,
  applyMessages,
  checksPass,
  childrenOf,
  getAt,
  resolve,
  resolveText,
  setAt,
  type Surfaces,
} from './model.ts'

const catalogue = new Set(['Column', 'Text', 'Button', 'TextField'])

describe('JSON Pointer, with relative paths', () => {
  it('reads, writes and removes, copying rather than changing', () => {
    const data = { user: { name: 'Ada' }, items: [{ n: 1 }, { n: 2 }] }
    expect(getAt(data, '/items/1/n')).toBe(2)

    const written = setAt(data, '/user/name', 'Grace')
    expect(getAt(written, '/user/name')).toBe('Grace')
    expect(data.user.name).toBe('Ada')

    expect(setAt(written, '/user/name', undefined)).toEqual({ user: {}, items: data.items })
    expect(setAt({}, '/a/b', 1)).toEqual({ a: { b: 1 } })
  })

  it('resolves a path without a leading slash against the template item', () => {
    expect(absolutePath('name', '/employees/0')).toBe('/employees/0/name')
    expect(absolutePath('/company', '/employees/0')).toBe('/company')
    expect(absolutePath('name', '/')).toBe('/name')
  })
})

describe('values', () => {
  const scope = { data: { email: 'a@b.co', count: 3, tags: [] }, path: '/' }

  it('are literals, paths, or calls of the functions the client implements', () => {
    expect(resolve('Hello', scope)).toBe('Hello')
    expect(resolve({ path: '/count' }, scope)).toBe(3)
    expect(resolve({ path: '/missing' }, scope)).toBeNull()
    expect(resolve({ call: 'email', args: { value: { path: '/email' } } }, scope)).toBe(true)
    expect(resolve({ call: 'required', args: { value: { path: '/tags' } } }, scope)).toBe(false)
    expect(
      resolveText({ call: 'formatString', args: { value: 'You have ${/count} items' } }, scope),
    ).toBe('You have 3 items')
    expect(resolve({ call: 'eval', args: { code: 'alert(1)' } }, scope)).toBeNull()
  })

  it('pass checks only when every condition holds', () => {
    const checks = [
      { condition: { call: 'required', args: { value: { path: '/email' } } }, message: 'Email' },
    ]
    expect(checksPass(checks, scope)).toBe(true)
    expect(checksPass(checks, { ...scope, data: {} })).toBe(false)
  })
})

describe('children', () => {
  it('are a list of ids, or a template repeated per item with its own scope', () => {
    const scope = { data: { rows: [{ a: 1 }, { a: 2 }] }, path: '/' }
    expect(childrenOf(['x', 'y'], scope).map(child => child.id)).toEqual(['x', 'y'])
    expect(
      childrenOf({ componentId: 'row', path: '/rows' }, scope).map(child => child.scope.path),
    ).toEqual(['/rows/0', '/rows/1'])
  })
})

describe('applyMessages', () => {
  const create = { version: 'v0.9', createSurface: { surfaceId: 's', catalogId: 'c' } }

  it('creates a surface, upserts its components by id, updates and deletes it', () => {
    let applied = applyMessages(
      new Map(),
      [
        create,
        {
          version: 'v0.9.1',
          updateComponents: {
            surfaceId: 's',
            components: [{ id: 'root', component: 'Text', text: 'A' }],
          },
        },
        { version: 'v0.9', updateDataModel: { surfaceId: 's', path: '/name', value: 'Ada' } },
      ],
      catalogue,
    )
    if ('error' in applied) throw new Error(applied.error.message)
    let surfaces: Surfaces = applied.surfaces
    expect(surfaces.get('s')?.data).toEqual({ name: 'Ada' })

    applied = applyMessages(
      surfaces,
      [
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 's',
            components: [{ id: 'root', component: 'Text', text: 'B' }],
          },
        },
      ],
      catalogue,
    )
    if ('error' in applied) throw new Error(applied.error.message)
    surfaces = applied.surfaces
    expect(surfaces.get('s')?.components.get('root')).toMatchObject({ text: 'B' })

    applied = applyMessages(
      surfaces,
      [{ version: 'v0.9', deleteSurface: { surfaceId: 's' } }],
      catalogue,
    )
    expect('surfaces' in applied && applied.surfaces.size).toBe(0)
  })

  it('refuses a component the catalogue lacks, with a path the agent can correct', () => {
    const applied = applyMessages(
      new Map(),
      [
        create,
        {
          version: 'v0.9',
          updateComponents: { surfaceId: 's', components: [{ id: 'root', component: 'Script' }] },
        },
      ],
      catalogue,
    )
    expect(applied).toEqual({
      error: expect.objectContaining({
        code: 'UNKNOWN_COMPONENT',
        path: '/messages/1/updateComponents/components/0/component',
      }) as unknown,
    })
  })

  it('refuses an unknown version and an update to a surface nobody created', () => {
    expect(
      applyMessages(new Map(), [{ version: 'v0.8', createSurface: {} }], catalogue),
    ).toMatchObject({
      error: { code: 'VALIDATION_FAILED' },
    })
    expect(
      applyMessages(
        new Map(),
        [{ version: 'v0.9', updateDataModel: { surfaceId: 'nope' } }],
        catalogue,
      ),
    ).toMatchObject({ error: { code: 'SURFACE_NOT_FOUND' } })
  })
})
