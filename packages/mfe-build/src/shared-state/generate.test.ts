import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ts } from '../discovery/ts-ast.ts'
import { planContainer } from '../plan.ts'
import { createContainer, cleanupContainers } from '../testing/fixtures.ts'
import { TEST_PROFILE } from '../testing/profile.ts'
import { checkSharedStateBuild, sharedStateTransformRule } from './integration.ts'
import { compileSharedState } from './compiler.ts'

const temporary: string[] = []
afterEach(() => {
  cleanupContainers()
  temporary.splice(0).forEach(path => rmSync(path, { recursive: true, force: true }))
})
const profile = {
  ...TEST_PROFILE,
  framework: 'react',
  definitions: { ...TEST_PROFILE.definitions, factoryModules: ['@company/mfe-react'] },
}
const schema = `z.object({ units: z.enum(['metric','imperial']).default('metric'), selection: z.strictObject({ id: z.string(), run: z.string().nullable(), mode: z.string().optional() }).nullable().default(null) })`
const entry = `import {z} from 'zod'; import {createApp} from '@company/mfe-react'; export default createApp({id:'reader', router: makeRouter, sharedStateSchema: ${schema}})`
function manifest() {
  const source = ts.createSourceFile(
    'schema.ts',
    `import {z} from 'zod'; const schema=${schema}`,
    ts.ScriptTarget.Latest,
    true,
  )
  return compileSharedState(
    (source.statements[1] as ts.VariableStatement).declarationList.declarations[0]!.initializer!,
    source,
  )
}

describe('shared-state generated bindings and production pipeline', () => {
  it('generates definition aliases, per-key assets and only references in registry metadata', () => {
    const root = createContainer({ 'src/mfe.ts': entry })
    const plan = planContainer(profile, { containerRoot: root })
    expect(plan.aliases['#mfe/shared-state']).toBe(join(root, '.mfe/shared-state/reader.ts'))
    const descriptor = plan.generated.descriptor.definitions[0]!
    expect(descriptor.sharedState?.contracts).toHaveLength(2)
    expect(JSON.stringify(descriptor)).not.toContain('fields')
    const assets = plan.generated.files.filter(file => file.asset?.startsWith('shared-state/'))
    expect(assets).toHaveLength(2)
    const rule = sharedStateTransformRule(plan)!
    expect(rule.enforce).toBe('pre')
    expect(rule.include).toEqual([plan.entryFile])
    expect(() => checkSharedStateBuild(plan, false)).not.toThrow()
    expect(() => checkSharedStateBuild(plan, true)).toThrow('missing-baseline')
    const policyFile = join(root, 'state-policy.json')
    writeFileSync(policyFile, JSON.stringify({ baselines: [], supported: [], catalog: manifest() }))
    expect(() =>
      checkSharedStateBuild(
        planContainer(profile, { containerRoot: root, sharedStatePolicy: 'state-policy.json' }),
        true,
      ),
    ).not.toThrow()
    rmSync(policyFile)
    expect(() =>
      checkSharedStateBuild(
        planContainer(profile, { containerRoot: root, sharedStatePolicy: 'state-policy.json' }),
        true,
      ),
    ).toThrow()
  })
  it('gives multiple definitions separate bindings without an ambiguous container-wide alias', () => {
    const root = createContainer({
      'src/mfe.ts': `import {z} from 'zod'; import {createWidget} from '@company/mfe-react'; export const first=createWidget({id:'first',inputSchema:z.object({}),outputSchema:z.object({}),render:()=>null,sharedStateSchema:z.object({a:z.string().default('a')})}); export const second=createWidget({id:'second',inputSchema:z.object({}),outputSchema:z.object({}),render:()=>null,sharedStateSchema:z.object({b:z.boolean().default(false)})});`,
    })
    const plan = planContainer(profile, { containerRoot: root })
    expect(plan.aliases['#mfe/shared-state']).toBeUndefined()
    expect(plan.aliases['#mfe/shared-state/first']).toBeDefined()
    expect(plan.aliases['#mfe/shared-state/second']).toBeDefined()
    const first = plan.generated.files.find(file =>
      file.path.endsWith('shared-state/first.ts'),
    )!.contents
    expect(first).toContain('"a"')
    expect(first).not.toContain('"b"')
  })
  it('generates Angular bindings consistent with its injection/signal API', () => {
    const root = createContainer({ 'src/mfe.ts': entry })
    const plan = planContainer({ ...profile, framework: 'angular' }, { containerRoot: root })
    const file = plan.generated.files.find(candidate =>
      candidate.path.endsWith('shared-state/reader.ts'),
    )!
    expect(file.contents).toContain('injectSharedState, injectSharedStateStore')
    expect(file.contents).not.toContain('useSharedState')
  })
  it('typechecks generated React bindings and router context, rejecting wrong keys, wrong values and missing materialized fields', () => {
    const root = createContainer({ 'src/mfe.ts': entry })
    const plan = planContainer(profile, { containerRoot: root })
    const directory = mkdtempSync(join(tmpdir(), 'mfe-state-types-'))
    temporary.push(directory)
    const generated = join(directory, 'shared-state.ts')
    writeFileSync(
      generated,
      plan.generated.files.find(file => file.path.endsWith('shared-state/reader.ts'))!.contents,
    )
    const file = join(directory, 'types.ts')
    writeFileSync(
      file,
      `import {useSharedState, type SharedStateValues, type AppRouterOptions} from './shared-state'; import {createApp} from '@company/mfe-react'; function component(){ const [units,set]=useSharedState('units'); const materialized: 'metric' | 'imperial' = units; void set('imperial');\n// @ts-expect-error unknown key\nuseSharedState('unknown');\n// @ts-expect-error incorrect enum\nset('wrong');\nconst [selection,setSelection]=useSharedState('selection'); void setSelection({id:'42',run:null});\n// @ts-expect-error required materialized run missing\nsetSelection({id:'42'});\nreturn selection;}\nfunction makeRouter({context}:AppRouterOptions){ const units:'metric'|'imperial'=context.mfe.sharedState.get('units'); void context.mfe.sharedState.set('selection',null); return {} as import('@tanstack/react-router').AnyRouter;} createApp({id:'reader',router:makeRouter});`,
    )
    const repository = resolve(import.meta.dirname, '../../../..')
    const program = ts.createProgram([file], {
      target: ts.ScriptTarget.ES2023,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      customConditions: ['mfe-source'],
      strict: true,
      skipLibCheck: true,
      allowImportingTsExtensions: true,
      noEmit: true,
      jsx: ts.JsxEmit.ReactJSX,
      paths: {
        '@company/mfe-react/shared-state': [
          join(repository, 'packages/mfe-react/src/hooks/shared-state.ts'),
        ],
        '@company/mfe-core/shared-state': [
          join(repository, 'packages/mfe-core/src/shared-state/index.ts'),
        ],
        '@company/mfe-react': [join(repository, 'packages/mfe-react/src/index.ts')],
        '@tanstack/react-router': [
          join(
            repository,
            'packages/mfe-react/node_modules/@tanstack/react-router/dist/esm/index.d.ts',
          ),
        ],
      },
    })
    const diagnostics = ts
      .getPreEmitDiagnostics(program)
      .filter(
        diagnostic => diagnostic.file?.fileName === file || diagnostic.file?.fileName === generated,
      )
    expect(
      diagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')),
    ).toEqual([])
    expect(dirname(generated)).toBe(directory)
  }, 30_000)
})
