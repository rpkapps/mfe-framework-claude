import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { normalize, type StateContract } from '@company/mfe-core/shared-state'
import { parseSourceFile, ts } from '../discovery/ts-ast.ts'
import { discoverDefinitions } from '../discovery/definitions.ts'
import {
  compareContracts,
  compileSharedState,
  contractFor,
  checkSharedStateRelease,
  requirementsFor,
  validateArtifact,
} from './compiler.ts'
import { transformSharedStateSource } from './transform.ts'
import { stateType } from './generate.ts'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})
const syntax = {
  factoryModules: ['@company/mfe-react', '@company/mfe-angular'],
  appOptions: 'router: makeRouter',
  iconExample: 'icon: Icon',
}
function compile(schema: string) {
  const file = ts.createSourceFile(
    'contract.ts',
    `import { z } from 'zod'; const schema = ${schema}`,
    ts.ScriptTarget.Latest,
    true,
  )
  const statement = file.statements[1] as ts.VariableStatement
  return compileSharedState(statement.declarationList.declarations[0]!.initializer!, file)
}
function temporary() {
  const directory = mkdtempSync(join(tmpdir(), 'mfe-shared-state-'))
  directories.push(directory)
  return directory
}
const base = `z.object({ 'selection': z.strictObject({ wellId: z.string(), details: z.strictObject({ run: z.string() }).optional(), items: z.array(z.strictObject({ id: z.string() })) }).nullable().default(null) })`

describe('shared-state contract compiler and release gate', () => {
  it('produces stable, per-key fingerprints independent of property or enum order', () => {
    expect(
      compile(
        `z.object({ units: z.enum(['metric', 'imperial']).default('metric'), selected: z.strictObject({ b: z.string(), a: z.number() }) })`,
      ),
    ).toEqual(
      compile(
        `z.object({ selected: z.strictObject({ a: z.number(), b: z.string() }), units: z.enum(['imperial','metric']).default('metric') })`,
      ),
    )
    const original = compile(base).contracts[0]!
    expect(
      compile(
        base.replace("'selection':", "unrelated: z.boolean().default(false), 'selection':"),
      ).contracts.find(item => item.id === 'selection'),
    ).toEqual(original)
  })
  it('matches Zod for the supported primitives, wrappers, constraints, arrays and nested defaults', () => {
    const manifest = compile(
      `z.object({ key: z.strictObject({ count: z.number().int().min(-2).max(8), name: z.string().min(1).max(10), list: z.array(z.string()).max(2), note: z.string().nullable().optional(), settings: z.strictObject({ units: z.enum(['metric','imperial']).default('metric') }) }) })`,
    )
    const schema = z.strictObject({
      count: z.number().int().min(-2).max(8),
      name: z.string().min(1).max(10),
      list: z.array(z.string()).max(2),
      note: z.string().nullable().optional(),
      settings: z.strictObject({ units: z.enum(['metric', 'imperial']).default('metric') }),
    })
    const values = [
      { count: 1, name: 'test', list: ['a'], settings: {} },
      { count: -2, name: 'x', list: [], note: null, settings: { units: 'imperial' } },
      { count: 1.5, name: 'x', list: [], settings: {} },
      { count: 2, name: '', list: ['a', 'b', 'c'], settings: {} },
    ]
    for (const value of values) {
      const result = schema.safeParse(value)
      if (result.success)
        expect(normalize(manifest.contracts[0]!.node, value, 'key')).toEqual(result.data)
      else expect(() => normalize(manifest.contracts[0]!.node, value, 'key')).toThrow()
    }
  })
  for (const expression of [
    'z.string().transform(x => x)',
    'z.number().refine(x => x > 0)',
    'z.coerce.number()',
    'z.string().default(() => "random")',
    'z.lazy(() => schema)',
    'z.union([z.string(),z.number()])',
    'z.record(z.string(),z.string())',
    'z.string().meta({ type: "number" })',
    'z.string().trim()',
    'z.string().default(42)',
    'z.object({ ...fields })',
  ])
    it(`fails closed on ${expression}`, () => {
      expect(() => compile(`z.object({ key: ${expression} })`)).toThrow()
    })
  it('allows supported optional/defaulted additions but rejects all unsafe evolution', () => {
    const previous = compile(base).contracts[0]!
    const additive = compile(
      base
        .replace(
          'wellId: z.string()',
          "wellId: z.string(), comparison: z.string().optional(), mode: z.string().default('baseline')",
        )
        .replace('run: z.string()', 'run: z.string(), label: z.string().optional()'),
    ).contracts[0]!
    expect(compareContracts(previous, additive)).toEqual([])
    for (const change of [
      'wellId: z.number()',
      "wellId: z.string().default('changed')",
      'wellId: z.string().nullable()',
      'wellId: z.string(), mode: z.string()',
    ]) {
      expect(
        compareContracts(
          previous,
          compile(base.replace('wellId: z.string()', change)).contracts[0]!,
        ),
      ).not.toEqual([])
    }
    expect(
      compareContracts(
        previous,
        compile(base.replace('id: z.string()', 'id: z.string(), extra: z.string().optional()'))
          .contracts[0]!,
      ),
    ).not.toEqual([])
    expect(
      compareContracts(previous, compile(base.replace('wellId: z.string(), ', '')).contracts[0]!),
    ).not.toEqual([])
  })
  it('checks every supported baseline, contracts availability and artifact integrity', () => {
    const previous = compile(base)
    const candidate = compile(
      base.replace('wellId: z.string()', 'wellId: z.string(), extra: z.string().optional()'),
    )
    expect(() =>
      checkSharedStateRelease([candidate, previous], {
        schema: candidate,
        baselines: [previous],
      }),
    ).not.toThrow()
    expect(() =>
      checkSharedStateRelease([previous], { schema: candidate, baselines: [previous] }),
    ).not.toThrow()
    expect(() =>
      checkSharedStateRelease([candidate], {
        schema: { formatVersion: 1, contracts: [] },
        baselines: [previous],
      }),
    ).toThrow('missing-contract')
    const incompatible = compile(base.replace('wellId: z.string()', 'wellId: z.number()'))
    expect(() =>
      checkSharedStateRelease([incompatible], {
        schema: incompatible,
        baselines: [previous],
      }),
    ).toThrow('incompatible-change')
    expect(() => validateArtifact({ ...candidate.contracts[0]!, revision: 'tampered' })).toThrow(
      'fingerprint',
    )
    expect(() =>
      validateArtifact(
        contractFor('unsafe', { kind: 'anything' } as unknown as StateContract['node']),
      ),
    ).toThrow('unsupported node')
  })
  it('resolves local nested schema references without executing source modules', () => {
    const directory = temporary()
    const file = join(directory, 'mfe.ts')
    writeFileSync(
      join(directory, 'contracts.ts'),
      `import {z} from 'zod'; const details = z.strictObject({ id: z.string() }); export const schema = z.object({ selected: details.nullable().default(null) }); throw new Error('must never execute');`,
    )
    writeFileSync(
      file,
      `import {createApp} from '@company/mfe-react'; import {schema} from './contracts'; export default createApp({ id: 'reader', sharedStateSchema: schema, router: makeRouter });`,
    )
    expect(discoverDefinitions(file, syntax).definitions[0]!.sharedState!.contracts[0]!.id).toBe(
      'selected',
    )
  })
  it('resolves published packages through precompiled manifests and fails closed when unavailable', () => {
    const directory = temporary()
    const packageDirectory = join(directory, 'node_modules/@domain/state')
    mkdirSync(packageDirectory, { recursive: true })
    writeFileSync(
      join(packageDirectory, 'package.json'),
      JSON.stringify({
        name: '@domain/state',
        exports: { './shared-state.manifest.json': './shared-state.manifest.json' },
      }),
    )
    writeFileSync(
      join(packageDirectory, 'shared-state.manifest.json'),
      JSON.stringify({ schemas: { sharedStateSchema: compile(base) } }),
    )
    const file = join(directory, 'mfe.ts')
    const source = `import {createApp} from '@company/mfe-react'; import {sharedStateSchema} from '@domain/state'; export default createApp({ id: 'reader', sharedStateSchema, router: makeRouter });`
    writeFileSync(file, source)
    expect(discoverDefinitions(file, syntax).definitions[0]!.sharedState).toEqual(compile(base))
    rmSync(join(packageDirectory, 'shared-state.manifest.json'))
    expect(() => discoverDefinitions(file, syntax)).toThrow('Cannot resolve precompiled')
  })
  it('replaces declarations and prunes shared-state-only schema imports and local helpers', () => {
    const manifest = compile(base)
    const source = `import {z} from 'zod'; import {createApp} from '@company/mfe-react'; const field = z.string(); const sharedStateSchema = z.object({ selected: field.default('') }); export default createApp({ id: 'reader', sharedStateSchema, router: makeRouter });`
    const output = transformSharedStateSource(source, 'mfe.ts', {
      reader: requirementsFor(manifest),
    })
    expect(output).not.toContain('sharedStateSchema')
    expect(output).not.toContain("from 'zod'")
    expect(output).not.toContain('z.string')
    expect(output).toContain('sharedState:')
    expect(output).toContain(manifest.contracts[0]!.revision)
  })
  it('keeps Zod needed by unrelated widget contracts and binds each definition independently', () => {
    const manifest = compile(base)
    const refs = requirementsFor(manifest)
    const source = `import {z} from 'zod'; import {createWidget} from '@company/mfe-react'; import {schema} from './domain'; export const one = createWidget({id:'one', sharedStateSchema: schema, inputSchema: z.object({}), outputSchema: z.object({}), render: () => null}); export const two = createWidget({id:'two', sharedStateSchema: z.object({units:z.string().default('metric')}), inputSchema:z.object({}), outputSchema:z.object({}), render:() => null});`
    const output = transformSharedStateSource(source, 'mfe.ts', {
      one: refs,
      two: { protocolVersion: 1, contracts: [{ id: 'units', revision: 'other' }] },
    })
    expect(output).not.toContain('sharedStateSchema')
    expect(output).not.toContain("from './domain'")
    expect(output).toContain("from 'zod'")
    expect(output).toContain('"other"')
    expect(parseSourceFile('mfe.ts', output).statements.length).toBeGreaterThan(0)
  })
  it('materializes defaults in generated value types, retaining optional deletion and nullable clears', () => {
    expect(
      stateType(
        compile(
          `z.object({ key: z.strictObject({ count: z.number().default(1), note: z.string().optional(), details: z.strictObject({ id: z.string() }).nullable() }) })`,
        ).contracts[0]!.node,
      ),
    ).toBe(
      '{ "count": Exclude<number, undefined>; "details": { "id": string } | null; "note"?: string | undefined }',
    )
  })
})
