import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ts } from '../discovery/ts-ast.ts'
import { planContainer } from '../plan.ts'
import { createContainer, cleanupContainers } from '../testing/fixtures.ts'
import { TEST_PROFILE } from '../testing/profile.ts'
import { checkUserContextBuild, userContextTransformRule } from './integration.ts'
import { compileUserContext } from './compiler.ts'

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
const entry = `import {z} from 'zod'; import {createApp} from '@company/mfe-react'; export default createApp({id:'reader', router: makeRouter, userContextSchema: ${schema}})`
function manifest(expression = schema) {
  const source = ts.createSourceFile(
    'schema.ts',
    `import {z} from 'zod'; const schema=${expression}`,
    ts.ScriptTarget.Latest,
    true,
  )
  return compileUserContext(
    'reader',
    (source.statements[1] as ts.VariableStatement).declarationList.declarations[0]!.initializer!,
    source,
  )
}

describe('user-context generated bindings and production pipeline', () => {
  it('generates definition aliases, per-owner assets and only references in registry metadata', () => {
    const root = createContainer({ 'src/mfe.ts': entry })
    const plan = planContainer(profile, { containerRoot: root })
    expect(plan.aliases['#mfe/user-context']).toBe(join(root, '.mfe/user-context/reader.ts'))
    const descriptor = plan.generated.descriptor.definitions[0]!
    expect(descriptor.userContext?.contracts).toHaveLength(1)
    expect(JSON.stringify(descriptor)).not.toContain('fields')
    const assets = plan.generated.files.filter(file => file.asset?.startsWith('user-context/'))
    expect(assets).toHaveLength(1)
    const binding = plan.generated.files.find(file => file.path.endsWith('user-context/reader.ts'))!
    expect(binding.contents).toContain(
      "export type { UserContextReader, UserContextStore, UserContextSetter } from '@company/mfe-react/user-context'",
    )
    expect(binding.contents).not.toContain('@company/mfe-core')
    const rule = userContextTransformRule(plan)!
    expect(rule.enforce).toBe('pre')
    expect(rule.include).toEqual([plan.entryFile])
    expect(() => checkUserContextBuild(plan, false)).not.toThrow()
    expect(() => checkUserContextBuild(plan, true)).not.toThrow()
    const policyFile = join(root, 'state-policy.json')
    writeFileSync(policyFile, JSON.stringify(manifest()))
    expect(() =>
      checkUserContextBuild(
        planContainer(profile, {
          containerRoot: root,
          userContextBaselines: { reader: ['state-policy.json'] },
        }),
        true,
      ),
    ).not.toThrow()
    writeFileSync(policyFile, JSON.stringify(manifest().contracts[0]))
    expect(() =>
      checkUserContextBuild(
        planContainer(profile, {
          containerRoot: root,
          userContextBaselines: { reader: ['state-policy.json'] },
        }),
        true,
      ),
    ).not.toThrow()
    rmSync(policyFile)
    expect(() =>
      checkUserContextBuild(
        planContainer(profile, {
          containerRoot: root,
          userContextBaselines: { reader: ['state-policy.json'] },
        }),
        true,
      ),
    ).toThrow()
  })
  it('gives multiple definitions separate bindings without an ambiguous container-wide alias', () => {
    const root = createContainer({
      'src/mfe.ts': `import {z} from 'zod'; import {createWidget} from '@company/mfe-react'; export const first=createWidget({id:'first',inputSchema:z.object({}),outputSchema:z.object({}),render:()=>null,userContextSchema:z.object({a:z.string().default('a')})}); export const second=createWidget({id:'second',inputSchema:z.object({}),outputSchema:z.object({}),render:()=>null,userContextSchema:z.object({b:z.boolean().default(false)})});`,
    })
    const plan = planContainer(profile, { containerRoot: root })
    expect(plan.aliases['#mfe/user-context']).toBeUndefined()
    expect(plan.aliases['#mfe/user-context/first']).toBeDefined()
    expect(plan.aliases['#mfe/user-context/second']).toBeDefined()
    const first = plan.generated.files.find(file =>
      file.path.endsWith('user-context/first.ts'),
    )!.contents
    expect(first).toContain('"a"')
    expect(first).not.toContain('"b"')
  })
  it('keeps owner revisions independent and emits explicit read-only-owner requirements', () => {
    const root = createContainer({
      'src/mfe.ts': `import {z} from 'zod'; import {createApp} from '@company/mfe-react'; export default createApp({id:'reader',router:makeRouter,userContextSchema:z.object({selected:z.string().default('')}),userContextReads:{'other-owner':z.object({selected:z.number().default(0)})}})`,
    })
    const plan = planContainer(profile, { containerRoot: root })
    const requirements = plan.generated.descriptor.definitions[0]!.userContext!
    expect(requirements.ownerId).toBe('reader')
    expect(requirements.contracts.map(contract => contract.id)).toEqual(['reader', 'other-owner'])
    const binding = plan.generated.files.find(file =>
      file.path.endsWith('user-context/reader.ts'),
    )!.contents
    expect(binding).toContain('"selected": Exclude<string, undefined>')
    expect(binding).not.toContain('Exclude<number, undefined>')
  })
  it('fails closed on incompatible and wrong-owner explicit baselines', () => {
    const root = createContainer({ 'src/mfe.ts': entry })
    const baseline = manifest()
    const path = join(root, 'baseline.json')
    const options = { containerRoot: root, userContextBaselines: { reader: ['baseline.json'] } }
    writeFileSync(
      path,
      JSON.stringify({
        ...baseline,
        contracts: [{ ...baseline.contracts[0], id: 'someone-else' }],
      }),
    )
    expect(() => checkUserContextBuild(planContainer(profile, options), true)).toThrow(
      'Baseline must contain one contract for reader',
    )
    writeFileSync(
      path,
      JSON.stringify({
        ...baseline,
        contracts: [{ ...baseline.contracts[0], revision: 'tampered' }],
      }),
    )
    expect(() => checkUserContextBuild(planContainer(profile, options), false)).toThrow(
      'fingerprint',
    )
    writeFileSync(
      path,
      JSON.stringify(manifest(schema.replace("z.enum(['metric','imperial'])", 'z.string()'))),
    )
    expect(() => checkUserContextBuild(planContainer(profile, options), true)).toThrow(
      'incompatible-change',
    )
  })
  it('generates Angular bindings consistent with its injection/signal API', () => {
    const root = createContainer({ 'src/mfe.ts': entry })
    const plan = planContainer({ ...profile, framework: 'angular' }, { containerRoot: root })
    const file = plan.generated.files.find(candidate =>
      candidate.path.endsWith('user-context/reader.ts'),
    )!
    expect(file.contents).toContain('injectUserContext, injectUserContextStore')
    expect(file.contents).not.toContain('useUserContext')
    expect(file.contents).toContain(
      "export type { UserContextReader, UserContextStore, UserContextSetter } from '@company/mfe-angular/user-context'",
    )
    expect(file.contents).not.toContain('@company/mfe-core')
  })
  it('typechecks generated React bindings and router context, rejecting wrong keys, wrong values and missing materialized fields', () => {
    const root = createContainer({ 'src/mfe.ts': entry })
    const plan = planContainer(profile, { containerRoot: root })
    const directory = mkdtempSync(join(tmpdir(), 'mfe-state-types-'))
    temporary.push(directory)
    const generated = join(directory, 'user-context.ts')
    writeFileSync(
      generated,
      plan.generated.files.find(file => file.path.endsWith('user-context/reader.ts'))!.contents,
    )
    const file = join(directory, 'types.ts')
    writeFileSync(
      file,
      `import {useUserContext, type UserContextValues, type AppRouterOptions} from './user-context'; import {createApp} from '@company/mfe-react';
function component(){
 const context = useUserContext();
 const units: 'metric' | 'imperial' = context.get('units');
 void context.set('units', 'imperial');
 // @ts-expect-error unknown key
 context.get('unknown');
 // @ts-expect-error incorrect enum
 context.set('units', 'wrong');
 void context.set('selection', {id:'42',run:null});
 void context.set('selection', {id:'42'});
 // @ts-expect-error materialized read requires run
 const invalidRead: UserContextValues['selection'] = {id:'42'};
 const other = useUserContext<{ selected: string }>('other-owner');
 const selected: string = other.get('selected');
 // @ts-expect-error cross-owner contexts are read-only
 other.set('selected', 'no');
 return units + selected;
}
function makeRouter({context}:AppRouterOptions){ const units:'metric'|'imperial'=context.mfe.userContext.get('units'); void context.mfe.userContext.set('selection',null); return {} as import('@tanstack/react-router').AnyRouter;}
createApp({id:'reader',router:makeRouter});`,
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
        '@company/mfe-react/user-context': [
          join(repository, 'packages/mfe-react/src/hooks/user-context.ts'),
        ],
        '@company/mfe-core/user-context': [
          join(repository, 'packages/mfe-core/src/user-context/index.ts'),
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
