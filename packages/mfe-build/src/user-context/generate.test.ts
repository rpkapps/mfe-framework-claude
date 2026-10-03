import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ts } from '../discovery/ts-ast.ts'
import { planContainer } from '../plan.ts'
import { createContainer, cleanupContainers } from '../testing/fixtures.ts'
import { TEST_PROFILE } from '../testing/profile.ts'
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
const entry = `import {z} from 'zod'; import {createApp} from '@company/mfe-react'; export default createApp({id:'reader', router: makeRouter, userContext: { schema: ${schema} }})`
const repository = resolve(import.meta.dirname, '../../../..')
type Plan = ReturnType<typeof planContainer>
function contents(plan: Plan, suffix: string): string {
  return plan.generated.files.find(file => file.path.endsWith(suffix))!.contents
}
/** The binding and the declaration it infers its types from, side by side as the build writes them. */
function writeBinding(plan: Plan, id = 'reader'): { directory: string; generated: string } {
  const directory = mkdtempSync(join(tmpdir(), 'mfe-state-types-'))
  temporary.push(directory)
  const generated = join(directory, 'user-context.ts')
  writeFileSync(
    generated,
    contents(plan, `user-context/${id}.ts`).replace(`./${id}.declaration.ts`, './declaration.ts'),
  )
  writeFileSync(join(directory, 'declaration.ts'), contents(plan, `${id}.declaration.ts`))
  return { directory, generated }
}
const zod = join(repository, 'packages/mfe-build/node_modules/zod/index.d.cts')

describe('user-context generated bindings', () => {
  it('copies a reader-only declaration for the binding types and publishes nothing for it', () => {
    const root = createContainer({
      'src/mfe.ts': `import {z} from 'zod'; import {createApp} from '@company/mfe-react';
        export default createApp({id:'reader', router: makeRouter,
          userContext: {reads: {producer: z.object({preferences: z.object({theme: z.string()})})}}})`,
    })
    const plan = planContainer(profile, { containerRoot: root })
    expect(plan.generated.descriptor.definitions[0]).not.toHaveProperty('userContext')
    expect(plan.generated.files.some(file => file.asset?.startsWith('user-context/'))).toBe(false)
    const declaration = contents(plan, 'user-context/reader.declaration.ts')
    expect(declaration).toContain("import { z } from 'zod'")
    expect(declaration).toContain(
      'export const declaration = { reads: {producer: z.object({preferences: z.object({theme: z.string()})})} }',
    )
  })
  it('generates definition aliases and a binding typed from its declaration', () => {
    const root = createContainer({ 'src/mfe.ts': entry })
    const plan = planContainer(profile, { containerRoot: root })
    expect(plan.aliases['#mfe/user-context']).toBe(join(root, '.mfe/user-context/reader.ts'))
    const binding = contents(plan, 'user-context/reader.ts')
    expect(binding).toContain(
      "export type { UserContextReader, UserContextStore, UserContextSetter } from '@company/mfe-react/user-context'",
    )
    expect(binding).toContain("import type { declaration } from './reader.declaration.ts'")
    expect(binding).toContain(
      'createUserContextBindings<UserContextValues, UserContextReads>("reader")',
    )
    expect(binding).not.toContain('@company/mfe-core')
    expect(binding).not.toContain('useUserContextStore')
  })
  it('gives multiple definitions separate bindings without an ambiguous container-wide alias', () => {
    const root = createContainer({
      'src/mfe.ts': `import {z} from 'zod'; import {createWidget} from '@company/mfe-react'; export const first=createWidget({id:'first',inputSchema:z.object({}),outputSchema:z.object({}),render:()=>null,userContext:{schema:z.object({a:z.string().default('a')})}}); export const second=createWidget({id:'second',inputSchema:z.object({}),outputSchema:z.object({}),render:()=>null,userContext:{schema:z.object({b:z.boolean().default(false)})}});`,
    })
    const plan = planContainer(profile, { containerRoot: root })
    expect(plan.aliases['#mfe/user-context']).toBeUndefined()
    expect(plan.aliases['#mfe/user-context/first']).toBeDefined()
    expect(plan.aliases['#mfe/user-context/second']).toBeDefined()
    const first = contents(plan, 'user-context/first.declaration.ts')
    expect(first).toContain('a:z.string()')
    expect(first).not.toContain('b:z.boolean()')
  })
  it('copies the constants a declaration uses and imports the schemas it names from their module', () => {
    const root = createContainer({
      'src/schema.ts': `import {z} from 'zod'; export const settings = z.object({theme: z.string().default('light')})`,
      'src/mfe.ts': `import {z} from 'zod'; import {createApp} from '@company/mfe-react'; import {settings as shared} from './schema'; import type {Unrelated} from './types';
        const units = z.enum(['metric','imperial']); const unused = sideEffect();
        export default createApp({id:'reader', router: makeRouter, userContext: { schema: z.object({units: units.default('metric')}), reads: {other: shared} }})`,
    })
    const declaration = contents(
      planContainer(profile, { containerRoot: root }),
      'reader.declaration.ts',
    )
    expect(declaration).toContain("import { settings as shared } from '../../src/schema'")
    expect(declaration).toContain("const units = z.enum(['metric','imperial'])")
    expect(declaration).not.toContain('sideEffect')
    expect(declaration).not.toContain('Unrelated')
  })
  it('generates Angular bindings consistent with its injection/signal API', () => {
    const root = createContainer({ 'src/mfe.ts': entry })
    const plan = planContainer({ ...profile, framework: 'angular' }, { containerRoot: root })
    const file = plan.generated.files.find(candidate =>
      candidate.path.endsWith('user-context/reader.ts'),
    )!
    expect(file.contents).toContain('export const { injectUserContext }')
    expect(file.contents).not.toContain('injectUserContextStore')
    expect(file.contents).not.toContain('useUserContext')
    expect(file.contents).toContain(
      "export type { UserContextReader, UserContextStore, UserContextSetter } from '@company/mfe-angular/user-context'",
    )
    expect(file.contents).not.toContain('@company/mfe-core')
  })
  it('typechecks generated React selectors, inferred owner reads and router context', () => {
    const root = createContainer({
      'src/mfe.ts': entry.replace(
        'userContext: { schema:',
        "userContext: { reads:{'other-owner':z.object({selected:z.string().default('')})}, schema:",
      ),
    })
    const plan = planContainer(profile, { containerRoot: root })
    const { directory, generated } = writeBinding(plan)
    const file = join(directory, 'types.ts')
    writeFileSync(
      file,
      `import {useUserContext, type UserContextValues, type AppRouterOptions} from './user-context'; import {createApp} from '@company/mfe-react';
function component(){
 const [units, set] = useUserContext(context => context.units);
 const checkedUnits: 'metric' | 'imperial' = units;
 void set('units', 'imperial');
 // @ts-expect-error unknown selected key
 useUserContext(context => context.unknown);
 // @ts-expect-error incorrect enum
 set('units', 'wrong');
 void set('selection', {id:'42',run:null});
 void set('selection', {id:'42'});
 const [run] = useUserContext(context => context.selection?.run);
 const checkedRun: string | null | undefined = run;
 // @ts-expect-error materialized read requires run
 const invalidRead: UserContextValues['selection'] = {id:'42'};
 const other = useUserContext('other-owner', context => context.selected);
 const selected: string = other[0];
 // @ts-expect-error cross-owner tuple has no setter
 const [value, foreignSet] = other;
 // @ts-expect-error undeclared owners cannot be read
 useUserContext('undeclared', context => context.selected);
 // @ts-expect-error foreign keys come from the declared read schema
 useUserContext('other-owner', context => context.units);
 // @ts-expect-error owner selection must be explicit
 useUserContext();
 return units + selected;
}
function makeRouter({context}:AppRouterOptions){ const units:'metric'|'imperial'=context.mfe.userContext.get('units'); void context.mfe.userContext.set('selection',null); return {} as import('@tanstack/react-router').AnyRouter;}
createApp({id:'reader',router:makeRouter});`,
    )
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
        zod: [zod],
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
  it('typechecks generated Angular signals and omits writes from foreign bindings', () => {
    const root = createContainer({
      'src/mfe.ts': entry.replace(
        'userContext: { schema:',
        "userContext: { reads:{'other-owner':z.object({selected:z.string().default('')})}, schema:",
      ),
    })
    const plan = planContainer({ ...profile, framework: 'angular' }, { containerRoot: root })
    const { directory, generated } = writeBinding(plan)
    const file = join(directory, 'types.ts')
    writeFileSync(
      file,
      `import {injectUserContext} from './user-context';
function consumer(){
 const context = injectUserContext(value => value.selection?.run);
 const run: string | null | undefined = context.value();
 void context.set('units', 'imperial');
 // @ts-expect-error invalid owner value
 context.set('units', 'unknown');
 // @ts-expect-error invalid selected key
 injectUserContext(value => value.unknown);
 const foreign = injectUserContext('other-owner', value => value.selected);
 const selected: string = foreign.value();
 // @ts-expect-error read-only binding omits the setter property
 foreign.set('selected', 'no');
 // @ts-expect-error undeclared owner
 injectUserContext('undeclared', value => value.selected);
 // @ts-expect-error selected key must belong to the declared foreign schema
 injectUserContext('other-owner', value => value.units);
 return selected;
}`,
    )
    const program = ts.createProgram([file], {
      target: ts.ScriptTarget.ES2023,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      customConditions: ['mfe-source'],
      strict: true,
      skipLibCheck: true,
      allowImportingTsExtensions: true,
      noEmit: true,
      paths: {
        zod: [zod],
        '@company/mfe-angular/user-context': [
          join(repository, 'packages/mfe-angular/src/inject/user-context.ts'),
        ],
        '@company/mfe-core/user-context': [
          join(repository, 'packages/mfe-core/src/user-context/index.ts'),
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
  }, 30_000)
})
