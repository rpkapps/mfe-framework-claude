import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { join, resolve } from 'node:path'
import { ts } from '../discovery/ts-ast.ts'

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
      '.generated-files.json',
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

  it('accepts only an absolute http(s) URL for an API origin, and leaves an optional one unset', () => {
    const result = plan(`
import { env } from '@acme/mfe-plugin'
import { z } from 'zod'

export default {
  api: env('API_URL', z.url().optional(), { api: true }),
}
`)
    const spec = result === null ? undefined : specsOf(result).get('api')
    if (spec === undefined) throw new Error('no api field')

    expect(spec.api).toBe(true)
    expect(checkConfigField(spec, 'https://api.example.test/v1/')).toEqual({
      ok: true,
      value: 'https://api.example.test/v1/',
    })
    expect(checkConfigField(spec, undefined)).toEqual({ ok: true, value: undefined })
    expect(checkConfigField(spec, 'mailto:ops@example.test')).toEqual({
      ok: false,
      problem: '"mailto:ops@example.test", which is not an absolute http(s) URL',
    })
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

describe('shell-owned user context', () => {
  it('typechecks the generated runtime wrapper, theme selector and owner read boundaries', () => {
    const result = plan(`${CONFIG}
export const userContext = {
  schema: z.object({ preferences: z.object({ theme: z.enum(['light','dark','system']) }) }),
  reads: { operations: z.object({ selection: z.object({ wellId: z.string().nullable() }) }) },
}`)!
    const generated = result.files.find(file => file.path.endsWith('/user-context.ts'))!.contents
    const root = createContainer({
      'user-context.ts': generated,
      'consumer.ts': `import {createMfeRuntime, useUserContext} from './user-context';
declare const base: Omit<Parameters<typeof createMfeRuntime>[0], 'theme' | 'shellState'>;
createMfeRuntime({...base, shellState: {user:null, groups:[]}, theme: {
  cacheKey: 'theme', select: context => context.preferences.theme,
}});
createMfeRuntime({...base, shellState: {user:null, groups:[], theme:'dark'}, theme: {
  cacheKey: 'theme',
  // @ts-expect-error theme selectors cannot access undeclared fields
  select: context => context.missing,
}});
createMfeRuntime({...base, shellState: {user:null, groups:[]}, theme: {
  cacheKey: 'theme',
  // @ts-expect-error theme selectors must return a supported preference
  select: context => context.preferences,
}});
function component() {
  const [theme, set] = useUserContext(context => context.preferences.theme);
  const preference: 'light' | 'dark' | 'system' = theme;
  void set('preferences', {theme:'dark'});
  // @ts-expect-error owner writes retain the generated schema
  void set('preferences', {theme:'blue'});
  const [wellId] = useUserContext('operations', context => context.selection.wellId);
  const selected: string | null = wellId;
  // @ts-expect-error foreign reads have no setter
  const [foreign, foreignSet] = useUserContext('operations', context => context.selection.wellId);
  // @ts-expect-error undeclared foreign fields are inaccessible
  useUserContext('operations', context => context.preferences);
  // @ts-expect-error undeclared owners are inaccessible
  useUserContext('unknown', context => context.selection);
  return {preference, selected};
}`,
    })
    const repository = resolve(import.meta.dirname, '../../../..')
    const file = join(root, 'consumer.ts')
    const program = ts.createProgram([file], {
      target: ts.ScriptTarget.ES2023,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      customConditions: ['mfe-source'],
      strict: true,
      exactOptionalPropertyTypes: true,
      skipLibCheck: true,
      allowImportingTsExtensions: true,
      noEmit: true,
      jsx: ts.JsxEmit.ReactJSX,
      paths: {
        '@company/mfe-react/host': [join(repository, 'packages/mfe-react/src/host/index.ts')],
        '@company/mfe-react/user-context': [
          join(repository, 'packages/mfe-react/src/hooks/user-context.ts'),
        ],
      },
    })
    const diagnostics = ts
      .getPreEmitDiagnostics(program)
      .filter(
        diagnostic =>
          diagnostic.file?.fileName === file ||
          diagnostic.file?.fileName === join(root, 'user-context.ts'),
      )
    expect(
      diagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')),
    ).toEqual([])
  }, 30_000)
  it('compiles only its own schema and declared read slices into a typed host binding', () => {
    const result = plan(`${CONFIG}
export const userContext = {
  schema: z.object({ preferences: z.object({ theme: z.enum(['light','dark','system']).default('system') }).default({theme:'system'}) }),
  reads: { operations: z.object({ selection: z.object({ wellId: z.string().nullable() }) }) },
}`)
    const module = result?.files.find(file => file.path.endsWith('/user-context.ts'))?.contents
    expect(result?.aliases['#mfe/user-context']).toMatch(/user-context.ts$/)
    expect(module).toContain(
      'createHostUserContextBindings<UserContextValues, UserContextReads>(registration.requirements)',
    )
    expect(module).toContain('UserContextThemeOptions<UserContextValues>')
    expect(module).toContain('__userContext: registration')
    expect(module).toContain('"wellId": string | null')
    expect(module).not.toContain("from 'zod'")
    const registration = /const registration = (.+) as const/.exec(module ?? '')?.[1]
    expect(JSON.parse(registration ?? '{}')).toMatchObject({
      contract: {
        id: 'shell',
        node: { fields: { preferences: { kind: 'default' } } },
      },
    })
    expect(result?.files.filter(file => file.path.includes('user-context'))).toHaveLength(1)
  })
  it('does not generate a binding for a shell that owns or reads no context', () => {
    expect(plan()?.aliases['#mfe/user-context']).toBeUndefined()
  })
  it('rejects ambiguous host declarations', () => {
    expect(() =>
      plan(`${CONFIG}\nexport const userContext = { schema: z.object({}), typo: true }`),
    ).toThrow('accepts unique schema and reads')
  })
})
