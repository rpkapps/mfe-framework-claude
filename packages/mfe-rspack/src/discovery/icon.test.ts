/**
 * The reader resolves an imported identifier to data. The fixture package is deliberately not
 * lucide: what the reader follows is ordinary ESM, and a test against only the real library
 * would not show that.
 */

import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { parseSvg, readIconData } from './icon.ts'

/** Any file in this package; only its directory matters, for resolving relative specifiers. */
const here = fileURLToPath(new URL('icon.test.ts', import.meta.url))
/** A file in an app, because that is where an icon library is actually a dependency. */
const shellEntry = fileURLToPath(
  new URL('../../../../apps/shell/src/shell/chrome.tsx', import.meta.url),
)

describe('an icon module', () => {
  it('follows a re-export to the node array', () => {
    const icon = readIconData(here, {
      imported: 'SparkIcon',
      moduleSpecifier: './__fixtures__/icon-pack/index.mjs',
    })

    expect(icon?.viewBox).toBe('0 0 32 32')
    expect(icon?.node[0]).toEqual(['path', { d: 'M4 4 L28 28' }])
  })

  it('keeps a group and the shapes it wraps', () => {
    const icon = readIconData(here, {
      imported: 'SparkIcon',
      moduleSpecifier: './__fixtures__/icon-pack/index.mjs',
    })

    expect(icon?.node[1]).toEqual([
      'g',
      { transform: 'translate(2 2)' },
      [['circle', { cx: '8', cy: '8', r: '4' }]],
    ])
  })

  it('drops the library’s own render key, which is not an attribute', () => {
    const icon = readIconData(here, {
      imported: 'Spark',
      moduleSpecifier: './__fixtures__/icon-pack/index.mjs',
    })

    expect(JSON.stringify(icon)).not.toContain('key')
  })

  it('applies the stroked outline the format implies', () => {
    const icon = readIconData(here, {
      imported: 'SparkIcon',
      moduleSpecifier: './__fixtures__/icon-pack/index.mjs',
    })

    expect(icon?.attributes).toMatchObject({ fill: 'none', stroke: 'currentColor' })
  })

  it('reads a bare specifier through the package’s ESM entry', () => {
    // `require.resolve` lands on the CommonJS bundle, whose re-exports no parser can follow.
    const icon = readIconData(shellEntry, { imported: 'SunIcon', moduleSpecifier: 'lucide-react' })

    expect(icon?.viewBox).toBe('0 0 24 24')
    expect(icon?.node.length).toBeGreaterThan(0)
    expect(icon?.node.every(([tag]) => tag === 'path' || tag === 'circle')).toBe(true)
  })

  it('resolves an aliased import by the name the module exports', () => {
    const aliased = readIconData(shellEntry, { imported: 'Sun', moduleSpecifier: 'lucide-react' })
    const direct = readIconData(shellEntry, {
      imported: 'SunIcon',
      moduleSpecifier: 'lucide-react',
    })

    expect(aliased).toEqual(direct)
  })
})

describe('an svg file', () => {
  it('keeps a non-square viewBox, which a size cannot express', () => {
    const icon = readIconData(here, {
      imported: 'default',
      moduleSpecifier: './__fixtures__/well-head.svg',
    })

    expect(icon?.viewBox).toBe('0 0 32 20')
    expect(icon?.node).toEqual([
      ['path', { d: 'M2 18 L16 2 L30 18' }],
      [
        'g',
        { transform: 'translate(0 1)' },
        [['rect', { x: '12', y: '10', width: '8', height: '8', rx: '1' }]],
      ],
    ])
  })

  it('carries its own paint rather than the outline defaults', () => {
    const icon = readIconData(here, {
      imported: 'default',
      moduleSpecifier: './__fixtures__/badge.svg',
    })

    expect(icon?.attributes).toEqual({ fill: 'currentColor' })
    expect(icon?.node).toEqual([['circle', { cx: '12', cy: '12', r: '9', 'fill-rule': 'evenodd' }]])
  })

  it('drops a tag that is not a shape and an attribute that is not paint', () => {
    const icon = readIconData(here, {
      imported: 'default',
      moduleSpecifier: './__fixtures__/well-head.svg',
    })

    const serialized = JSON.stringify(icon)
    expect(serialized).not.toContain('script')
    expect(serialized).not.toContain('ignored')
  })

  it('refuses an svg with no viewBox, because nothing says how to scale it', () => {
    expect(parseSvg('<svg><path d="M0 0 L1 1"/></svg>')).toBeNull()
  })
})

describe('an identifier that leads nowhere', () => {
  it('is null rather than a guess, so the caller can report the position', () => {
    expect(readIconData(here, { imported: 'Missing', moduleSpecifier: './nope.mjs' })).toBeNull()
    expect(readIconData(here, { imported: 'Button', moduleSpecifier: 'vitest' })).toBeNull()
  })
})
