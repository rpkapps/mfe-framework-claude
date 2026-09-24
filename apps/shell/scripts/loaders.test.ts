import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { env } from '@company/mfe-rspack/env'

import { inlineShellLoaders, readShellLoaders } from './loaders.ts'

function root(files: Record<string, string>): string {
  const directory = mkdtempSync(join(tmpdir(), 'shell-loaders-'))
  mkdirSync(join(directory, 'src/loaders'), { recursive: true })
  for (const [name, source] of Object.entries(files)) {
    const file = join(directory, 'src/loaders', name)
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, source)
  }
  return directory
}

const LOADER = "customElements.define('a-loader', class extends HTMLElement {})"
const loader = env('SHELL_LOADER', z.enum(['drill-bit', 'well-log', 'cycle']).optional())
const declarations = { loader, fallback: 'drill-bit', minDuration: 1000 }

describe('readShellLoaders', () => {
  it('reads every loader the declaration lists, what draws by default and the minimum duration', () => {
    const loaders = readShellLoaders(
      root({ 'drill-bit.js': LOADER, 'well-log.js': LOADER }),
      declarations,
    )
    expect(loaders.fallback).toBe('drill-bit')
    expect(loaders.minDuration).toBe(1000)
    expect(loaders.loaders.map(loader => loader.name)).toEqual(['drill-bit', 'well-log'])
  })

  it('refuses a name with no file', () => {
    expect(() => readShellLoaders(root({ 'drill-bit.js': LOADER }), declarations)).toThrow(
      /can name 'well-log', but there is no src\/loaders\/well-log\.js/,
    )
  })

  it('refuses a file no name reaches', () => {
    expect(() =>
      readShellLoaders(
        root({ 'drill-bit.js': LOADER, 'well-log.js': LOADER, 'pumpjack.js': LOADER }),
        declarations,
      ),
    ).toThrow(/pumpjack\.js cannot be chosen/)
  })

  it('reads a directory of loaders as a family that shares its kit', () => {
    const loaders = readShellLoaders(
      root({
        'drill-bit.js': LOADER,
        'scenes/kit.js': 'const kit = {}',
        'scenes/well-log.js': "kit.define('well-log')",
      }),
      declarations,
    )
    expect(loaders.kits).toEqual([
      { name: 'scenes', file: 'src/loaders/scenes/kit.js', source: 'const kit = {}' },
    ])
    expect(loaders.loaders.map(loader => [loader.name, loader.kit])).toEqual([
      ['drill-bit', undefined],
      ['well-log', 'scenes'],
    ])
  })

  it('refuses a directory of loaders without a kit, and a name used twice', () => {
    expect(() =>
      readShellLoaders(
        root({ 'drill-bit.js': LOADER, 'scenes/well-log.js': LOADER }),
        declarations,
      ),
    ).toThrow(/needs the kit\.js its loaders share/)
    expect(() =>
      readShellLoaders(
        root({
          'drill-bit.js': LOADER,
          'well-log.js': LOADER,
          'scenes/kit.js': 'const kit = {}',
          'scenes/well-log.js': LOADER,
        }),
        declarations,
      ),
    ).toThrow(/'well-log' is also/)
  })

  it('refuses a declaration that is not an enum, and a default it does not list', () => {
    const files = root({ 'drill-bit.js': LOADER, 'well-log.js': LOADER })
    const only = (schema: z.ZodType) => ({
      loader: env('SHELL_LOADER', schema),
      fallback: 'drill-bit',
      minDuration: 0,
    })
    expect(() => readShellLoaders(files, only(z.string()))).toThrow(/z\.enum/)
    expect(() => readShellLoaders(files, { ...declarations, fallback: 'pumpjack' })).toThrow(
      /loader is 'pumpjack', which SHELL_LOADER does not list/,
    )
  })

  it("takes 'cycle' as a choice, not a loader, and refuses a loader of that name", () => {
    const files = { 'drill-bit.js': LOADER, 'well-log.js': LOADER }
    const loaders = readShellLoaders(root(files), { ...declarations, fallback: 'cycle' })
    expect(loaders.fallback).toBe('cycle')
    expect(loaders.loaders.map(loader => loader.name)).toEqual(['drill-bit', 'well-log'])
    expect(() => readShellLoaders(root({ ...files, 'cycle.js': LOADER }), declarations)).toThrow(
      /no loader can be called that/,
    )
  })

  it('refuses a minimum duration that is not a number of milliseconds', () => {
    const files = root({ 'drill-bit.js': LOADER, 'well-log.js': LOADER })
    expect(() => readShellLoaders(files, { ...declarations, minDuration: -1 })).toThrow(/0 or more/)
    expect(() => readShellLoaders(files, { ...declarations, minDuration: Number.NaN })).toThrow(
      /0 or more/,
    )
  })
})

describe('inlineShellLoaders', () => {
  it('minifies each loader into a function only the page calls', async () => {
    const source = `/* a long comment */\n;(() => {\n  const unused = 1\n  ${LOADER}\n})()\n`
    const inline = await inlineShellLoaders({
      fallback: 'drill-bit',
      minDuration: 1000,
      loaders: [{ name: 'drill-bit', file: 'src/loaders/drill-bit.js', source }],
      kits: [],
    })
    expect(inline).not.toContain('a long comment')
    expect(inline).not.toContain('unused')

    const defined: string[] = []
    const loaders = new Function('customElements', 'HTMLElement', `return ${inline}`)(
      { define: (name: string) => defined.push(name) },
      class {},
    ) as {
      fallback: string
      minDuration: number
      draw: Record<string, { run: () => void }>
    }
    expect(loaders.fallback).toBe('drill-bit')
    expect(loaders.minDuration).toBe(1000)
    expect(defined).toEqual([])
    loaders.draw['drill-bit']?.run()
    expect(defined).toEqual(['a-loader'])
  })

  it('hands a family loader its kit, which is inlined once', async () => {
    const inline = await inlineShellLoaders({
      fallback: 'a',
      minDuration: 0,
      loaders: [
        { name: 'a', file: 'a.js', source: "kit.define('a')", kit: 'scenes' },
        { name: 'b', file: 'b.js', source: "kit.define('b')", kit: 'scenes' },
      ],
      kits: [
        {
          name: 'scenes',
          file: 'kit.js',
          source: 'const kit = { defined: [], define(name) { this.defined.push(name) } }',
        },
      ],
    })
    expect(inline.match(/defined:\[\]/g)).toHaveLength(1)
    const loaders = new Function(`return ${inline}`)() as {
      kits: Record<string, () => { defined: string[] }>
      draw: Record<string, { kit?: string; run: (kit: unknown) => void }>
    }
    const entry = loaders.draw['b']
    const kit = entry?.kit === undefined ? undefined : loaders.kits[entry.kit]?.()
    entry?.run(kit)
    expect(kit?.defined).toEqual(['b'])
  })

  it('never ends the script element it is inlined into', async () => {
    const inline = await inlineShellLoaders({
      fallback: 'x',
      minDuration: 0,
      loaders: [{ name: 'x', file: 'src/loaders/x.js', source: "console.log('</script>')" }],
      kits: [],
    })
    expect(inline).not.toMatch(/<\/script/i)
  })
})
