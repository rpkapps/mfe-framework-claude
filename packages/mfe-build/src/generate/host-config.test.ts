import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { checkConfigField, type ConfigFieldSpec } from '../config/check.ts'
import { cleanupContainers, createContainer } from '../testing/fixtures.ts'
import { TEST_PROFILE } from '../testing/profile.ts'
import { planHostConfig, type HostConfigPlan } from './host-config.ts'

/**
 * Every kind of field the build can read, once as the declarations file the build reads without
 * running it, and once as the same Zod schemas, so the Zod-free check can be held to Zod's answers.
 */
const CONFIG = `
import { env } from '@acme/mfe-plugin'
import { z } from 'zod'

export default {
  url: env('URL', z.string().url()),
  optionalUrl: env('OPTIONAL_URL', z.url().optional()),
  flag: env('FLAG', z.boolean().default(false)),
  coerced: env('COERCED', z.coerce.boolean()),
  count: env('COUNT', z.number().int().min(1).max(10)),
  ratio: env('RATIO', z.number().positive().optional()),
  mode: env('MODE', z.enum(['staging', 'production'])),
  label: env('LABEL', z.string().trim().min(2).nullable()),
  shout: env('SHOUT', z.string().toUpperCase().default('quiet')),
  tags: env('TAGS', z.array(z.string().min(1)).max(3).default([])),
  limits: env('LIMITS', z.object({ retries: z.number().int(), backoff: z.number().optional() }).optional()),
  code: env('CODE', z.string().regex(/^[A-Z]{3}$/)),
  email: env('EMAIL', z.string().email().optional()),
  fixed: env('FIXED', z.literal('fixed').optional()),
}
`

const ZOD: Readonly<Record<string, z.ZodType>> = {
  url: z.string().url(),
  optionalUrl: z.url().optional(),
  flag: z.boolean().default(false),
  coerced: z.coerce.boolean(),
  count: z.number().int().min(1).max(10),
  ratio: z.number().positive().optional(),
  mode: z.enum(['staging', 'production']),
  label: z.string().trim().min(2).nullable(),
  shout: z.string().toUpperCase().default('quiet'),
  tags: z.array(z.string().min(1)).max(3).default([]),
  limits: z.object({ retries: z.number().int(), backoff: z.number().optional() }).optional(),
  code: z.string().regex(/^[A-Z]{3}$/),
  email: z.string().email().optional(),
  fixed: z.literal('fixed').optional(),
}

const SAMPLES: Readonly<Record<string, readonly unknown[]>> = {
  url: ['https://api.example.com', 'not a url', undefined, 5],
  optionalUrl: [undefined, 'https://login.example.com/realms/a', 'nope'],
  flag: [undefined, true, 'true'],
  coerced: [undefined, 'false', 0, 1, null],
  count: [5, 0, 11, 2.5, '5'],
  ratio: [0.5, -1, 0, undefined],
  mode: ['staging', 'dev', undefined],
  label: ['  ab  ', ' a ', null, undefined, 3],
  shout: [undefined, 'loud'],
  tags: [undefined, ['a'], ['a', 'b', 'c', 'd'], [''], 'a'],
  limits: [undefined, { retries: 1 }, { retries: 1.5 }, { retries: 1, backoff: 2 }, {}],
  code: ['ABC', 'abc', 'ABCD'],
  email: [undefined, 'a@b.co', 'nope'],
  fixed: [undefined, 'fixed', 'other'],
}

afterEach(() => {
  cleanupContainers()
})

function plan(config = CONFIG): HostConfigPlan | null {
  const root = createContainer(
    { 'src/mfe.config.ts': config },
    { manifest: { name: '@acme/shell' } },
  )
  return planHostConfig({
    root,
    generator: TEST_PROFILE.generator,
    envModules: TEST_PROFILE.envModules,
    checkModule: '@acme/mfe-plugin/env',
  })
}

function specsOf(result: HostConfigPlan): ReadonlyMap<string, ConfigFieldSpec> {
  const module = result.files.find(file => file.path.endsWith('config.ts'))
  const json = /const FIELDS: readonly ConfigFieldSpec\[\] = (\[[\s\S]*?\n\])/.exec(
    module?.contents ?? '',
  )?.[1]
  const specs = JSON.parse(json ?? '[]') as ConfigFieldSpec[]
  return new Map(specs.map(spec => [spec.field, spec]))
}

describe('the Zod-free check a host runs', () => {
  const result = plan()
  if (result === null) throw new Error('the fixture declares a configuration')
  const specs = specsOf(result)

  for (const [field, samples] of Object.entries(SAMPLES)) {
    for (const sample of samples) {
      it(`answers as Zod does for ${field} = ${JSON.stringify(sample) ?? 'nothing'}`, () => {
        const spec = specs.get(field)
        const schema = ZOD[field]
        if (spec === undefined || schema === undefined) throw new Error(`no ${field}`)
        const expected = schema.safeParse(sample)
        const actual = checkConfigField(spec, sample)

        expect(actual.ok).toBe(expected.success)
        if (actual.ok && expected.success) expect(actual.value).toEqual(expected.data)
      })
    }
  }
})

describe('planHostConfig', () => {
  it('generates nothing for a host that declares no configuration', () => {
    const root = createContainer({ 'src/index.ts': '' })
    expect(
      planHostConfig({
        root,
        generator: TEST_PROFILE.generator,
        envModules: TEST_PROFILE.envModules,
        checkModule: '@acme/mfe-plugin/env',
      }),
    ).toBeNull()
  })

  it('writes the same deployment files a container gets, and a #mfe/config beside them', () => {
    const result = plan()
    const names = result?.files.map(file => file.path.split(/[\\/]/).at(-1)).sort()
    expect(names).toEqual([
      '.env.example',
      '.gitignore',
      'config.ts',
      'runtime-config.defaults.json',
      'runtime-config.schema.json',
      'runtime-config.sh',
    ])
    expect(Object.keys(result?.aliases ?? {})).toEqual(['#mfe/config'])
    expect(result?.defaults?.asset).toBe('runtime-config.json')
  })

  it('keeps Zod out of the module: its type comes through an import the bundler erases', () => {
    const module = plan()?.files.find(file => file.path.endsWith('config.ts'))?.contents ?? ''
    expect(module).toContain(
      "import { checkConfigField, type ConfigFieldSpec } from '@acme/mfe-plugin/env'",
    )
    expect(module).toMatch(/import type descriptors from '.*mfe\.config\.ts'/)
    expect(module).toContain("import type { InferEnvConfig } from '@acme/mfe-plugin'")
    expect(module).not.toMatch(/from 'zod'/)
    expect(module).not.toContain('safeParse')
    expect(module).toContain("const CONTAINER_ID = 'shell'")
  })

  it('fetches so a preload in the host document answers it, and names a single-page fallback', () => {
    const module = plan()?.files.find(file => file.path.endsWith('config.ts'))?.contents ?? ''
    expect(module).toContain("await fetch(CONFIG_URL, { credentials: 'same-origin' })")
    expect(module).toContain("response.headers.get('Content-Type')")
    expect(module).toContain('The host configuration contract declares this expectation.')
  })

  it('carries the declared defaults, the transforms and the coercion into the check', () => {
    const result = plan()
    if (result === null) throw new Error('no plan')
    const specs = specsOf(result)
    expect(specs.get('flag')).toMatchObject({ hasDefault: true, defaultValue: false })
    expect(specs.get('label')?.transforms).toEqual(['trim'])
    expect(specs.get('coerced')?.coerce).toBe('boolean')
    expect(JSON.parse(result.defaults?.contents ?? '{}')).toEqual({
      flag: false,
      shout: 'quiet',
      tags: [],
    })
  })
})
