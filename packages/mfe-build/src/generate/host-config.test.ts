import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { runInNewContext } from 'node:vm'
import { readFileSync, writeFileSync } from 'node:fs'
import hostUserContextLoader from '../user-context/host-loader.ts'
import { join, resolve } from 'node:path'
import { ts } from '../discovery/ts-ast.ts'
import { transformUserContextSource } from '../user-context/transform.ts'
import { build } from 'esbuild'

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
  const schema = `z.object({ preferences: z.object({ theme: z.enum(['light','dark','system']) }) })`
  const source = `import {z} from 'zod'; import {createMfeRuntime} from '@company/mfe-react/host';
    const settings = ${schema};
    createMfeRuntime({...hostOptions, userContext:{schema:settings, reads:{operations:z.object({selection:z.object({wellId:z.string().nullable()})})}, adapter, onError(error){report(error)}},theme:{select:context=>context.preferences.theme,cacheKey:'theme'}});`
  function host(
    files: Record<string, string> = { 'src/index.ts': source },
    entries?: readonly string[],
  ) {
    const root = createContainer(files, { manifest: { name: '@acme/shell' } })
    return planHostConfig({
      root,
      generator: TEST_PROFILE.generator,
      envModules: TEST_PROFILE.envModules,
      checkModule: '@acme/mfe-plugin/env',
      ...(entries ? { entries } : {}),
    })!
  }
  it('generates only the typed hook without an environment config or runtime wrapper', () => {
    const result = host()
    const module = result.files.find(file => file.path.endsWith('/user-context.ts'))!.contents
    expect(result.configSource).toBeUndefined()
    expect(result.defaults).toBeNull()
    expect(result.aliases['#mfe/config']).toBeUndefined()
    expect(result.aliases['#mfe/user-context']).toBeDefined()
    expect(module).toContain('createHostUserContextBindings<UserContextValues, UserContextReads>')
    expect(module).not.toContain('createMfeRuntime')
    expect(module).not.toContain('zod')
    expect(result.userContext?.registration.contract).toMatchObject({ id: 'shell' })
  })
  it('follows custom entry imports and compiles imported owner schemas without evaluating them', () => {
    const result = host(
      {
        'client/main.ts': `import('./boot')`,
        'client/boot.ts': `import {createMfeRuntime as boot} from '@company/mfe-react/host'; import {settings} from './schema'; boot({userContext:{schema:settings,adapter}})`,
        'client/schema.ts': `import {z} from 'zod'; export const settings=${schema}; throw new Error('must not run')`,
      },
      ['client/main.ts'],
    )
    expect(result.userContext?.source).toMatch(/client[/\\]boot.ts$/)
    expect(result.userContext?.registration.contract).toMatchObject({ id: 'shell' })
  })
  it('recompiles changed imported schemas and refreshes hook types during watch builds', () => {
    const authored = `import {createMfeRuntime} from '@company/mfe-react/host'; import {schema} from './schema'; createMfeRuntime({userContext:{schema,adapter}})`
    const result = host({
      'src/index.ts': authored,
      'src/schema.ts': `import {z} from 'zod'; export const schema=z.object({theme:z.string()})`,
    })
    const dependencies: string[] = []
    const loader = {
      resourcePath: result.userContext!.source,
      addDependency: (file: string) => {
        dependencies.push(file)
      },
      getOptions: () => ({
        root: result.options.containerRoot,
        id: 'shell',
        generatedDir: result.options.generatedDir,
        generator: 'test',
      }),
    }
    const before = hostUserContextLoader.call(loader, authored)
    const schemaFile = join(result.options.containerRoot, 'src/schema.ts')
    writeFileSync(
      schemaFile,
      `import {z} from 'zod'; export const schema=z.object({theme:z.enum(['light','dark'])})`,
    )
    const after = hostUserContextLoader.call(loader, authored)
    expect(after).not.toEqual(before)
    expect(dependencies).toContain(schemaFile)
    expect(readFileSync(join(result.options.generatedDir, 'user-context.ts'), 'utf8')).toContain(
      '"dark" | "light"',
    )
  })
  it('strips schema-only dependencies while preserving transport and normal runtime imports', async () => {
    const result = host()
    const transformed = transformUserContextSource(
      source + '\nexport type Settings = z.infer<typeof settings>',
      'boot.ts',
      {},
      result.userContext!.registration,
    )
    expect(transformed).toContain('adapter')
    expect(transformed).toContain('onError(error)')
    expect(transformed).toContain('report(error)')
    expect(transformed).toContain('__userContext:')
    expect(transformed).toContain('...hostOptions')
    const bundle = await build({
      stdin: { contents: transformed, loader: 'ts' },
      bundle: true,
      write: false,
      metafile: true,
      external: ['@company/mfe-react/host'],
      minify: true,
      format: 'esm',
    })
    expect(Object.keys(bundle.metafile.inputs)).toEqual(['<stdin>'])
    expect(bundle.outputFiles[0]!.text).not.toContain('zod')
    expect(bundle.outputFiles[0]!.text).toContain('onError(')
  })
  it.each([
    source.replace('schema:settings,', '...other,schema:settings,'),
    source.replace('adapter, onError', 'adapter, schema:settings, onError'),
    source.replace('},theme:', '},...other,theme:'),
    source + source,
  ])('rejects ambiguous host context declarations', value => {
    expect(() => host({ 'src/index.ts': value })).toThrow()
  })
  it('preserves evaluation order of live adapter, error handler and later runtime options', () => {
    const authored = `import {z} from 'zod'; import {createMfeRuntime} from '@company/mfe-react/host'; createMfeRuntime({userContext:{schema:z.object({theme:z.string()}),adapter:mark('adapter'),onError:mark('onError')},loader:mark('loader')})`
    const result = host({ 'src/index.ts': authored })
    const transformed = transformUserContextSource(
      authored,
      'index.ts',
      {},
      result.userContext!.registration,
    )
    const calls: string[] = []
    runInNewContext(
      ts.transpileModule(transformed, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText,
      {
        exports: {},
        require: () => ({
          createMfeRuntime: () => {
            calls.push('runtime')
          },
        }),
        mark: (name: string) => {
          calls.push(name)
          return name
        },
      },
    )
    expect(calls).toEqual(['adapter', 'onError', 'loader', 'runtime'])
  })
  it('preserves JSX in custom host entries', () => {
    const authored = source + '\nroot.render(<App />)'
    const result = host({ 'client/start.jsx': authored }, ['client/start.jsx'])
    const transformed = transformUserContextSource(
      authored,
      'client/start.jsx',
      {},
      result.userContext!.registration,
    )
    expect(transformed).toContain('root.render(<App />)')
  })
  it('keeps unrelated side effects whose binding names match schema fields', () => {
    const authored = source.replace(
      'const settings',
      'const theme = registerTheme(); const string = registerString(); const settings',
    )
    const result = host({ 'src/index.ts': authored })
    const transformed = transformUserContextSource(
      authored,
      'index.ts',
      {},
      result.userContext!.registration,
    )
    expect(transformed).toContain('const theme = registerTheme()')
    expect(transformed).toContain('const string = registerString()')
  })
  it('ignores local functions shadowing the imported runtime factory', () => {
    const authored =
      source +
      `function helper(createMfeRuntime: Function) { createMfeRuntime({userContext:{schema:unrelated,adapter}}); }`
    const result = host({ 'src/index.ts': authored })
    const transformed = transformUserContextSource(
      authored,
      'index.ts',
      {},
      result.userContext!.registration,
    )
    expect(transformed).toContain('schema: unrelated')
    expect(transformed.match(/__userContext:/g)).toHaveLength(1)
  })
  it('ignores type-only modules and refuses unsupported Angular host bindings', () => {
    expect(
      host({
        'src/index.ts': `import type {Example} from './types';\n${source}`,
        'src/types.ts': source,
      }).userContext,
    ).toBeDefined()
    expect(() =>
      host({
        'src/index.ts': source.replace('@company/mfe-react/host', '@company/mfe-angular/host'),
      }),
    ).toThrow('Angular host')
  })
  it('does not mistake environment config exports for a runtime declaration', () => {
    const result = host({
      'src/mfe.config.ts': CONFIG + `\nexport const userContext={schema:${schema}}`,
    })
    expect(result.aliases['#mfe/user-context']).toBeUndefined()
  })

  it('typechecks generated host hooks and foreign read-only boundaries', () => {
    const result = host()
    const generated = result.files.find(file => file.path.endsWith('/user-context.ts'))!.contents
    const root = createContainer({
      'user-context.ts': generated,
      'consumer.ts': `import {useUserContext} from './user-context';
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
})
