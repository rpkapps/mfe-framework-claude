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
    writeFileSync(join(directory, 'src/loaders', name), source)
  }
  return directory
}

const LOADER = "customElements.define('a-loader', class extends HTMLElement {})"
const loader = env('SHELL_LOADER', z.enum(['drill-bit', 'well-log']).default('drill-bit'))
const ms = z.number().int().min(0).optional()
const minDuration = env(
  'SHELL_LOADER_MIN_DURATION',
  z.object({ 'drill-bit': ms, 'well-log': ms }).default({ 'drill-bit': 1000 }),
)
const declarations = { loader, minDuration }

describe('readShellLoaders', () => {
  it('reads every name the declaration lists, its default and the minimum durations', () => {
    const loaders = readShellLoaders(
      root({ 'drill-bit.js': LOADER, 'well-log.js': LOADER }),
      declarations,
    )
    expect(loaders.fallback).toBe('drill-bit')
    expect(loaders.minDuration).toEqual({ 'drill-bit': 1000 })
    expect(loaders.loaders.map(loader => loader.name)).toEqual(['drill-bit', 'well-log'])
  })

  it('refuses a name with no file', () => {
    expect(() => readShellLoaders(root({ 'drill-bit.js': LOADER }), declarations)).toThrow(
      /can name 'well-log', but src\/loaders\/well-log\.js does not exist/,
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

  it('refuses a declaration that is not an enum with a default', () => {
    const files = root({ 'drill-bit.js': LOADER })
    const only = (schema: z.ZodType) => ({ loader: env('SHELL_LOADER', schema), minDuration })
    expect(() => readShellLoaders(files, only(z.string()))).toThrow(/z\.enum/)
    expect(() => readShellLoaders(files, only(z.enum(['drill-bit'])))).toThrow(/\.default\(\)/)
  })

  it('refuses minimum durations that do not name every loader, and only loaders', () => {
    const files = root({ 'drill-bit.js': LOADER, 'well-log.js': LOADER })
    const durations = (shape: Record<string, z.ZodType>) => ({
      loader,
      minDuration: env('SHELL_LOADER_MIN_DURATION', z.object(shape).default({})),
    })
    expect(() => readShellLoaders(files, durations({ 'drill-bit': ms }))).toThrow(
      /no key for 'well-log'/,
    )
    expect(() =>
      readShellLoaders(files, durations({ 'drill-bit': ms, 'well-log': ms, pumpjack: ms })),
    ).toThrow(/'pumpjack' is not a loader/)
  })
})

describe('inlineShellLoaders', () => {
  it('minifies each loader into a function only the page calls', async () => {
    const source = `/* a long comment */\n;(() => {\n  const unused = 1\n  ${LOADER}\n})()\n`
    const inline = await inlineShellLoaders({
      fallback: 'drill-bit',
      minDuration: { 'drill-bit': 1000 },
      loaders: [{ name: 'drill-bit', file: 'src/loaders/drill-bit.js', source }],
    })
    expect(inline).not.toContain('a long comment')
    expect(inline).not.toContain('unused')

    const defined: string[] = []
    const loaders = new Function('customElements', 'HTMLElement', `return ${inline}`)(
      { define: (name: string) => defined.push(name) },
      class {},
    ) as {
      fallback: string
      minDuration: Record<string, number>
      draw: Record<string, () => void>
    }
    expect(loaders.fallback).toBe('drill-bit')
    expect(loaders.minDuration).toEqual({ 'drill-bit': 1000 })
    expect(defined).toEqual([])
    loaders.draw['drill-bit']?.()
    expect(defined).toEqual(['a-loader'])
  })

  it('never ends the script element it is inlined into', async () => {
    const inline = await inlineShellLoaders({
      fallback: 'x',
      minDuration: {},
      loaders: [{ name: 'x', file: 'src/loaders/x.js', source: "console.log('</script>')" }],
    })
    expect(inline).not.toMatch(/<\/script/i)
  })
})
