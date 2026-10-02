import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { normalize, type StateContract } from '@company/mfe-core/user-context'
import { parseSourceFile, ts } from '../discovery/ts-ast.ts'
import { discoverDefinitions } from '../discovery/definitions.ts'
import {
  compareContracts,
  compileUserContext,
  contractFor,
  checkUserContextRelease,
  requirementsFor,
  validateArtifact,
} from './compiler.ts'
import { transformUserContextSource } from './transform.ts'
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
function compile(schema: string, ownerId = 'reader') {
  const file = ts.createSourceFile(
    'contract.ts',
    `import { z } from 'zod'; const schema = ${schema}`,
    ts.ScriptTarget.Latest,
    true,
  )
  const statement = file.statements[1] as ts.VariableStatement
  return compileUserContext(ownerId, statement.declarationList.declarations[0]!.initializer!, file)
}
function temporary() {
  const directory = mkdtempSync(join(tmpdir(), 'mfe-user-context-'))
  directories.push(directory)
  return directory
}
const base = `z.object({ 'selection': z.strictObject({ wellId: z.string(), details: z.strictObject({ run: z.string() }).optional(), items: z.array(z.strictObject({ id: z.string() })) }).nullable().default(null) })`

describe('user-context contract compiler and release gate', () => {
  for (const fixture of [
    {
      expression: 'z.string().min(5).min(1).max(6).max(10)',
      schema: z.string().min(5).min(1).max(6).max(10),
      values: ['ab', 'valid', 'too long'],
    },
    {
      expression: 'z.number().min(5).min(1).max(6).max(10)',
      schema: z.number().min(5).min(1).max(6).max(10),
      values: [2, 5, 8],
    },
    {
      expression: 'z.array(z.string()).min(2).min(1).max(3).max(5)',
      schema: z.array(z.string()).min(2).min(1).max(3).max(5),
      values: [['a'], ['a', 'b'], ['a', 'b', 'c', 'd']],
    },
  ])
    it(`retains all accumulated bounds for ${fixture.expression}`, () => {
      const contract = compile(`z.object({ key: ${fixture.expression} })`).contracts[0]!
      for (const value of fixture.values) {
        const expected = fixture.schema.safeParse(value)
        if (expected.success)
          expect(normalize(contract.node, { key: value }, 'reader')).toEqual({ key: expected.data })
        else expect(() => normalize(contract.node, { key: value }, 'reader')).toThrow()
      }
    })
  it('produces stable, per-owner fingerprints independent of property or enum order', () => {
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
      compile(base.replace("'selection':", "unrelated: z.boolean().default(false), 'selection':"))
        .contracts[0],
    ).not.toEqual(original)
    expect(original.id).toBe('reader')
    expect(original.node.kind).toBe('object')
    expect(compile(base, 'other-owner').contracts[0]!.revision).not.toBe(original.revision)
    expect(compile(base).contracts[0]).toEqual(original)
    expect(compile(base, 'other-owner').contracts[0]!.revision).not.toBe(original.revision)
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
        expect(normalize(manifest.contracts[0]!.node, { key: value }, 'reader')).toEqual({
          key: result.data,
        })
      else expect(() => normalize(manifest.contracts[0]!.node, { key: value }, 'reader')).toThrow()
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
      checkUserContextRelease([candidate, previous], {
        schema: candidate,
        baselines: [previous],
      }),
    ).not.toThrow()
    expect(() =>
      checkUserContextRelease([previous], { schema: candidate, baselines: [previous] }),
    ).not.toThrow()
    expect(() =>
      checkUserContextRelease([candidate], {
        schema: { formatVersion: 1, contracts: [] },
        baselines: [previous],
      }),
    ).toThrow('missing-contract')
    const incompatible = compile(base.replace('wellId: z.string()', 'wellId: z.number()'))
    expect(() =>
      checkUserContextRelease([incompatible], {
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
      `import {createApp} from '@company/mfe-react'; import {schema} from './contracts'; export default createApp({ id: 'reader', userContextSchema: schema, router: makeRouter });`,
    )
    expect(discoverDefinitions(file, syntax).definitions[0]!.userContext!.contracts[0]!.id).toBe(
      'reader',
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
        exports: { './user-context.manifest.json': './user-context.manifest.json' },
      }),
    )
    writeFileSync(
      join(packageDirectory, 'user-context.manifest.json'),
      JSON.stringify({ schemas: { userContextSchema: compile(base) } }),
    )
    const file = join(directory, 'mfe.ts')
    const source = `import {createApp} from '@company/mfe-react'; import {userContextSchema} from '@domain/state'; export default createApp({ id: 'reader', userContextSchema, router: makeRouter });`
    writeFileSync(file, source)
    expect(discoverDefinitions(file, syntax).definitions[0]!.userContext).toEqual(compile(base))
    rmSync(join(packageDirectory, 'user-context.manifest.json'))
    expect(() => discoverDefinitions(file, syntax)).toThrow('Cannot resolve precompiled')
  })
  it.each(['@company/mfe-react', '@company/mfe-angular'])(
    'discovers separate own and cross-owner contracts for %s',
    factoryModule => {
      const directory = temporary()
      const file = join(directory, 'mfe.ts')
      writeFileSync(
        join(directory, 'contracts.ts'),
        `import { z } from 'zod'; export const selection = z.object({ wellId: z.string().nullable().default(null) }); throw new Error('must never execute');`,
      )
      writeFileSync(
        file,
        `import { z } from 'zod'; import { createApp } from '${factoryModule}'; import { selection } from './contracts';
         export default createApp({ id: 'reader', router: makeRouter, routes: [], userContextSchema: z.object({ units: z.string().default('metric') }), userContextReads: { producer: selection } });`,
      )
      const manifest = discoverDefinitions(file, syntax).definitions[0]!.userContext!
      expect(manifest.contracts).toEqual([
        compile("z.object({ units: z.string().default('metric') })").contracts[0],
        compile('z.object({ wellId: z.string().nullable().default(null) })', 'producer')
          .contracts[0],
      ])
      expect(requirementsFor(manifest, 'reader')).toMatchObject({
        ownerId: 'reader',
        contracts: [{ id: 'reader' }, { id: 'producer' }],
      })
    },
  )
  it('supports read-only definitions without inventing a writable owner contract', () => {
    const directory = temporary()
    const file = join(directory, 'mfe.ts')
    const source = `import { z } from 'zod'; import { createApp } from '@company/mfe-react';
      const producer = z.object({ selected: z.string().default('none') });
      export default createApp({ id: 'reader', router: makeRouter, userContextReads: { producer } });`
    writeFileSync(file, source)
    const manifest = discoverDefinitions(file, syntax).definitions[0]!.userContext!
    expect(manifest.contracts.map(contract => contract.id)).toEqual(['producer'])
    const requirements = requirementsFor(manifest, 'reader')
    expect(requirements.ownerId).toBe('reader')
    const output = transformUserContextSource(source, file, { reader: requirements })
    expect(output).not.toContain('userContextReads')
    expect(output).not.toContain("from 'zod'")
    expect(output).not.toContain('z.object')
    expect(output).toContain(manifest.contracts[0]!.revision)
    expect(output).toContain('"ownerId": "reader"')
  })
  it.each([
    'userContextReads: importedReads',
    'userContextReads: { ...importedReads }',
    'userContextReads: { [owner]: z.object({}) }',
    'userContextReads: { producer: z.object({}), producer: z.object({}) }',
    'userContextReads: {}, userContextReads: { producer: z.object({}) }',
    'userContextReads: { reader: z.object({}) }',
    "userContextReads: { '': z.object({}) }",
    "userContextReads: { 'Invalid Owner': z.object({}) }",
    'userContextReads: { producer() { return z.object({}) } }',
    'userContextReads: { producer: z.string() }',
    'userContextReads: { producer: z.object({ value: z.string().transform(x => x) }) }',
    'userContextReads() { return {} }',
    'get userContextReads() { return {} }',
  ])('fails closed on invalid read declaration %s', declaration => {
    const directory = temporary()
    const file = join(directory, 'mfe.ts')
    writeFileSync(
      file,
      `import { z } from 'zod'; import { createApp } from '@company/mfe-react';
       export default createApp({ id: 'reader', router: makeRouter, ${declaration} });`,
    )
    expect(() => discoverDefinitions(file, syntax)).toThrow('user-context/unsupported-schema')
  })
  it('replaces declarations and prunes user-context-only schema imports and local helpers', () => {
    const manifest = compile(base)
    const source = `import {z} from 'zod'; import {createApp} from '@company/mfe-react'; const field = z.string(); const userContextSchema = z.object({ selected: field.default('') }); export default createApp({ id: 'reader', userContextSchema, router: makeRouter });`
    const output = transformUserContextSource(source, 'mfe.ts', {
      reader: requirementsFor(manifest, 'reader'),
    })
    expect(output).not.toContain('userContextSchema')
    expect(output).not.toContain("from 'zod'")
    expect(output).not.toContain('z.string')
    expect(output).toContain('userContext:')
    expect(output).toContain(manifest.contracts[0]!.revision)
  })
  it('keeps Zod needed by unrelated widget contracts and binds each definition independently', () => {
    const manifest = compile(base, 'one')
    const refs = requirementsFor(manifest, 'one')
    const source = `import {z} from 'zod'; import {createWidget} from '@company/mfe-react'; import {schema} from './domain'; export const one = createWidget({id:'one', userContextSchema: schema, inputSchema: z.object({}), outputSchema: z.object({}), render: () => null}); export const two = createWidget({id:'two', userContextSchema: z.object({units:z.string().default('metric')}), inputSchema:z.object({}), outputSchema:z.object({}), render:() => null});`
    const output = transformUserContextSource(source, 'mfe.ts', {
      one: refs,
      two: {
        protocolVersion: 1,
        ownerId: 'two',
        contracts: [{ id: 'two', revision: 'other', capabilities: [] }],
      },
    })
    expect(output).not.toContain('userContextSchema')
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
      '{ "key": { "count": Exclude<number, undefined>; "details": { "id": string } | null; "note"?: string | undefined } }',
    )
  })
})
