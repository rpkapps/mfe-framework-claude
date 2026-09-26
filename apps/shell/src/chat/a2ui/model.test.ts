import { describe, expect, it } from 'vitest'

import config from '../../mfe.config.ts'
import {
  absolutePath,
  applyMessages,
  checksPass,
  childrenOf,
  getAt,
  imageOrigins,
  imageSource,
  resolve,
  resolveText,
  safeUrl,
  setAt,
  type JsonValue,
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

  it('reads only the data’s own members, and never writes a prototype or a huge array', () => {
    expect(getAt({}, '/constructor')).toBeUndefined()
    expect(getAt({ list: [1] }, '/list/length')).toBeUndefined()
    expect(resolveText({ path: '/toString' }, { data: {}, path: '/' })).toBe('')

    const data = { list: [1] }
    expect(setAt(data, '/__proto__/polluted', true)).toBe(data)
    expect(Object.prototype).not.toHaveProperty('polluted')
    expect(setAt(data, '/list/1', 2)).toEqual({ list: [1, 2] })
    expect(setAt(data, '/list/1000000000', 2)).toEqual({ list: [1] })
  })

  it('opens or loads only web addresses', () => {
    expect(safeUrl('/help', 'https://shell.test/')).toBe('https://shell.test/help')
    expect(safeUrl('javascript:alert(1)', 'https://shell.test/')).toBeUndefined()
    expect(safeUrl('data:text/html,<p>', 'https://shell.test/')).toBeUndefined()
  })

  it('resolves a path without a leading slash against the template item', () => {
    expect(absolutePath('name', '/employees/0')).toBe('/employees/0/name')
    expect(absolutePath('/company', '/employees/0')).toBe('/company')
    expect(absolutePath('name', '/')).toBe('/name')
  })
})

describe('images', () => {
  const PAGE = 'https://shell.test/operations'
  const allowed = imageOrigins('https://tiles.example.com')

  it('load from the page’s origin, relative or absolute', () => {
    expect(imageSource('/logo.png', PAGE, new Set())).toEqual({
      kind: 'load',
      url: 'https://shell.test/logo.png',
    })
    expect(imageSource('https://shell.test/a.png?x=1', PAGE, new Set())).toMatchObject({
      kind: 'load',
    })
  })

  it('load from an origin the deployment lists, and only that exact origin', () => {
    expect(imageSource('https://tiles.example.com/1/2/3.png', PAGE, allowed)).toEqual({
      kind: 'load',
      url: 'https://tiles.example.com/1/2/3.png',
    })
    for (const url of [
      'http://tiles.example.com/a.png',
      'https://tiles.example.com:8443/a.png',
      'https://evil.tiles.example.com/a.png',
      'https://tiles.example.com.evil.example/a.png',
    ]) {
      expect(imageSource(url, PAGE, allowed)).toMatchObject({ kind: 'withheld' })
    }
  })

  it('are withheld from anywhere else, saying the host', () => {
    expect(imageSource('https://evil.example/p.gif?d=secret', PAGE, allowed)).toEqual({
      kind: 'withheld',
      host: 'evil.example',
    })
    expect(imageSource('https://user:pw@evil.example:8080/p.gif', PAGE, allowed)).toEqual({
      kind: 'withheld',
      host: 'evil.example:8080',
    })
  })

  it('load a data: image, and no other data: URL', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo='
    expect(imageSource(png, PAGE, new Set())).toEqual({ kind: 'load', url: png })
    expect(imageSource('data:image/svg+xml,<svg/>', PAGE, new Set())).toMatchObject({
      kind: 'load',
    })
    for (const url of ['data:text/html,<script>alert(1)</script>', 'data:,image/png', 'data:']) {
      expect(imageSource(url, PAGE, new Set())).toEqual({ kind: 'withheld', host: undefined })
    }
  })

  it('are withheld without a host when the address is not a web one, and absent when empty', () => {
    for (const url of ['https://', 'http://[zz]/a.png', 'javascript:alert(1)', 'ftp://x/a.png']) {
      expect(imageSource(url, PAGE, allowed)).toEqual({ kind: 'withheld', host: undefined })
    }
    expect(imageSource('', PAGE, allowed)).toBeUndefined()
    expect(imageSource('  ', PAGE, allowed)).toBeUndefined()
  })
})

describe('AGENT_IMAGE_HOSTS', () => {
  // Checked at start-up against its declaration, which refuses the whole value when an entry is
  // not an origin, so a typo stops the shell and names the variable rather than loading nothing.
  const declared = config.agentImageHosts.schema

  it('is declared as comma-separated origins, with space around the commas, or nothing', () => {
    for (const value of [
      'https://tiles.example.com',
      '  https://tiles.example.com , http://localhost:8080,https://[::1]:8443  ',
    ]) {
      const parsed = declared.safeParse(value)
      expect(parsed.success, value).toBe(true)
      // What the declaration accepts is read entry for entry.
      expect(imageOrigins(parsed.data).size).toBe(value.split(',').length)
    }
    expect(declared.safeParse(undefined)).toEqual({ success: true, data: undefined })
  })

  it('refuses a bare host, a path, a wildcard, another scheme or an empty entry', () => {
    for (const value of [
      'tiles.example.com',
      'https://tiles.example.com/',
      'https://tiles.example.com/tiles',
      '*.example.com',
      'https://*.example.com',
      'ftp://tiles.example.com',
      'https://a.example.com,,https://b.example.com',
      'https://a.example.com,',
      'https://a.example.com https://b.example.com',
      '',
    ]) {
      expect(declared.safeParse(value).success, value).toBe(false)
    }
  })

  it('lists origins, comma-separated, as URL writes them', () => {
    expect(
      imageOrigins(
        ' https://Tiles.Example.com ,http://localhost:8080,https://[::1]:8443,https://a.test:443',
      ),
    ).toEqual(
      new Set([
        'https://tiles.example.com',
        'http://localhost:8080',
        'https://[::1]:8443',
        'https://a.test',
      ]),
    )
  })

  it('is empty when unset or blank', () => {
    expect(imageOrigins(undefined).size).toBe(0)
    expect(imageOrigins('').size).toBe(0)
    expect(imageOrigins(' , ').size).toBe(0)
  })

  it('drops an entry that is not an origin, rather than reading more into it', () => {
    expect(
      imageOrigins(
        [
          'tiles.example.com',
          '*.example.com',
          'https://*.example.com',
          'https://tiles.example.com/',
          'https://tiles.example.com/path',
          'ftp://tiles.example.com',
          'https://tiles.example.com:99999',
          'https://ok.example.com',
        ].join(','),
      ),
    ).toEqual(new Set(['https://ok.example.com']))
  })
})

describe('values', () => {
  const scope = { data: { email: 'a@b.co', count: 3, tags: [] }, path: '/' }
  const regex = (pattern: string, value: string): JsonValue =>
    resolve({ call: 'regex', args: { pattern, value } }, scope)

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

  it('check a value against a pattern', () => {
    expect(regex('^\\d{3}-\\d{4}$', '555-0100')).toBe(true)
    expect(regex('^[A-Z]{2}(\\d{4})?$', 'NO')).toBe(true)
    expect(regex('^[A-Z]{2}$', 'no')).toBe(false)
    expect(regex('(', 'a')).toBe(false)
  })

  it('fail a pattern that could backtrack for seconds, rather than run it', () => {
    const started = performance.now()
    expect(regex('^(a+)+$', `${'a'.repeat(28)}!`)).toBe(false)
    expect(regex('^(?:a*)*$', `${'a'.repeat(28)}!`)).toBe(false)
    expect(regex('^((a)+b?)*$', 'a')).toBe(false)
    expect(regex('^(a|aa)+$', 'a')).toBe(false)
    expect(regex('^(\\d{2}){2,}$', '1234')).toBe(false)
    expect(performance.now() - started).toBeLessThan(100)

    expect(regex(`^${'a'.repeat(201)}$`, 'a'.repeat(201))).toBe(false)
    expect(regex('^a*$', 'a'.repeat(1001))).toBe(false)
    expect(regex('^a*$', 'a'.repeat(1000))).toBe(true)
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
