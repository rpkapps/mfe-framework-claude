/**
 * The reader resolves an imported identifier to data. The fixture package is deliberately not
 * lucide: what the reader follows is ordinary ESM, and a test against only the real library
 * would not show that.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { parseSvg, readIconData } from './icon.ts'
import type * as TsAst from './ts-ast.ts'
import { parseModuleFile } from './ts-ast.ts'

vi.mock('./ts-ast.ts', async importOriginal => {
  const original = await importOriginal<typeof TsAst>()
  return { ...original, parseModuleFile: vi.fn(original.parseModuleFile) }
})

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

  it("drops a clip path's shapes with it, as an exported icon wraps them in defs", () => {
    const icon = parseSvg(`
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <g clip-path="url(#clip0)">
    <path d="M4 4 L20 20" stroke="currentColor"/>
  </g>
  <defs>
    <clipPath id="clip0">
      <rect width="24" height="24" fill="white"/>
    </clipPath>
  </defs>
</svg>`)

    expect(icon?.node).toEqual([
      ['g', {}, [['path', { d: 'M4 4 L20 20', stroke: 'currentColor' }]]],
    ])
  })

  it('keeps a group whose title closes inside it', () => {
    const icon = parseSvg(`
<svg viewBox="0 0 24 24">
  <g transform="translate(1 1)">
    <title>Well head</title>
    <path d="M2 2 L8 8"/>
  </g>
  <circle cx="12" cy="12" r="3"/>
</svg>`)

    expect(icon?.node).toEqual([
      ['g', { transform: 'translate(1 1)' }, [['path', { d: 'M2 2 L8 8' }]]],
      ['circle', { cx: '12', cy: '12', r: '3' }],
    ])
  })

  it('ignores a closing tag nothing opened, rather than closing the group around it', () => {
    const icon = parseSvg('<svg viewBox="0 0 24 24"><g></title><path d="M1 1"/></g></svg>')

    expect(icon?.node).toEqual([['g', {}, [['path', { d: 'M1 1' }]]]])
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

const packs: string[] = []

afterEach(() => {
  while (packs.length > 0) {
    const pack = packs.pop()
    if (pack !== undefined) rmSync(pack, { recursive: true, force: true })
  }
})

/** An icon module drawing one path at the given size, shaped as icon packages publish them. */
function iconSource(size: number): string {
  return [
    `const icon = { size: ${String(size)}, node: [['path', { d: 'M0 0 L1 1' }]] }`,
    'export default icon',
    '',
  ].join('\n')
}

/** A barrel of two icons in a fresh directory, so no earlier read has indexed it. */
function iconPack(): { readonly entry: string; readonly icon: (name: string) => string } {
  const root = mkdtempSync(join(tmpdir(), 'mfe-icons-'))
  packs.push(root)
  const write = (path: string, contents: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), contents)
  }
  write(
    'pack/index.mjs',
    [
      "export { default as Sun, default as SunIcon } from './icons/sun.mjs'",
      "export { default as Moon, default as MoonIcon } from './icons/moon.mjs'",
      '',
    ].join('\n'),
  )
  write('pack/icons/sun.mjs', iconSource(24))
  write('pack/icons/moon.mjs', iconSource(24))
  return { entry: join(root, 'src/mfe.ts'), icon: name => join(root, 'pack/icons', name) }
}

describe('icon modules read by one process', () => {
  const parsed = vi.mocked(parseModuleFile)

  it('parses a barrel and each icon module once, however many icons are read', () => {
    const pack = iconPack()
    const read = (imported: string) =>
      readIconData(pack.entry, { imported, moduleSpecifier: '../pack/index.mjs' })

    parsed.mockClear()
    for (const name of ['SunIcon', 'Sun', 'MoonIcon', 'SunIcon']) expect(read(name)).not.toBeNull()

    const root = dirname(dirname(pack.entry))
    expect(parsed.mock.calls.map(([file]) => relative(root, file))).toEqual([
      'pack/index.mjs',
      'pack/icons/sun.mjs',
      'pack/icons/moon.mjs',
    ])
  })

  it('reads an icon module again once it changes, as a watching build needs', () => {
    const pack = iconPack()
    const read = () =>
      readIconData(pack.entry, { imported: 'SunIcon', moduleSpecifier: '../pack/index.mjs' })

    expect(read()?.viewBox).toBe('0 0 24 24')
    writeFileSync(pack.icon('sun.mjs'), iconSource(320))

    expect(read()?.viewBox).toBe('0 0 320 320')
  })
})
