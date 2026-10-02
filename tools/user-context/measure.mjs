/** Reproducible declaration transfer costs; framework and third-party peers are separate. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { gzipSync, brotliCompressSync } from 'node:zlib'
import { performance } from 'node:perf_hooks'
import ts from 'typescript'
import {
  compileUserContext,
  requirementsFor,
} from '../../packages/mfe-build/dist/user-context/compiler.js'
import { transformUserContextSource } from '../../packages/mfe-build/dist/user-context/transform.js'
import { normalize } from '../../packages/mfe-core/dist/user-context/index.js'
import { UserContextRuntime } from '../../packages/mfe-runtime/dist/user-context/store.js'

const requireBuild = createRequire(
  new URL('../../packages/mfe-build/package.json', import.meta.url),
)
const { build } = requireBuild('esbuild')
// Ownership metadata and whole-slice capability paths make the largest fixture 588 bytes.
// Bound each declaration individually as well as the aggregate; authoring validators stay absent.
const DECLARATION_BYTES_PER_APP = 600
const bytes = value => ({
  raw: value.length,
  gzip: gzipSync(value).length,
  brotli: brotliCompressSync(value).length,
})
function declaration(id, extra = '') {
  const source = `import {z} from 'zod'; import {createApp} from '@company/mfe-react';
    const schema=z.object({selection:z.strictObject({id:z.string()${extra}}).nullable().default(null)});
    export default createApp({id:'${id}',router:()=>({}),userContextSchema:schema});`
  const file = ts.createSourceFile(`${id}.ts`, source, ts.ScriptTarget.Latest, true)
  const manifest = compileUserContext(
    id,
    file.statements[2].declarationList.declarations[0].initializer,
    file,
  )
  return { id, source, manifest, refs: requirementsFor(manifest, id) }
}
const old = declaration('old')
const newer = declaration('new', ',mode:z.string().default("baseline")')
const framework = await build({
  entryPoints: [
    new URL('../../packages/mfe-runtime/src/user-context/store.ts', import.meta.url).pathname,
  ],
  bundle: true,
  write: false,
  metafile: true,
  minify: true,
  format: 'esm',
  conditions: ['mfe-source'],
})
assert.ok(
  Object.keys(framework.metafile.inputs).every(
    path => !/mfe-build|zod|baseline|history/.test(path),
  ),
)
const frameworkBytes = bytes(Buffer.from(framework.outputFiles[0].contents))
const measurements = []
for (const [name, definitions] of [
  ['one-app', [old]],
  ['same-revision', [old, declaration('second')]],
  ['mixed-revisions', [old, newer]],
]) {
  const before = [],
    after = []
  for (const definition of definitions) {
    for (const [target, contents] of [
      [before, definition.source],
      [
        after,
        transformUserContextSource(definition.source, 'mfe.ts', {
          [definition.id]: definition.refs,
        }),
      ],
    ]) {
      const result = await build({
        stdin: { contents, loader: 'ts' },
        bundle: true,
        write: false,
        metafile: true,
        minify: true,
        format: 'esm',
        external: ['zod', '@company/mfe-react'],
      })
      const imports = Object.values(result.metafile.outputs)[0].imports.map(item => item.path)
      if (target === after) {
        assert.deepEqual(imports, ['@company/mfe-react'])
        assert.ok(result.outputFiles[0].contents.length <= DECLARATION_BYTES_PER_APP)
      }
      target.push(Buffer.from(result.outputFiles[0].contents))
    }
  }
  const contracts = new Map(
    definitions.flatMap(item =>
      item.manifest.contracts.map(contract => [contract.revision, contract]),
    ),
  )
  measurements.push({
    name,
    beforeParsedJs: bytes(Buffer.concat(before)),
    afterParsedJs: bytes(Buffer.concat(after)),
    contractPayload: bytes(Buffer.from(JSON.stringify([...contracts.values()]))),
    uniqueContracts: contracts.size,
    authoringValidatorsAfter: 0,
  })
}
const items = Array.from({ length: 10000 }, (_, index) => ({ id: String(index) }))
const node = {
  kind: 'array',
  item: { kind: 'object', strict: true, fields: { id: { kind: 'string' } } },
}
const start = performance.now()
for (let count = 0; count < 100; count++) normalize(node, items, 'benchmark')
const validationMs = (performance.now() - start) / 100
let publish
const service = new UserContextRuntime({
  scope: 'benchmark',
  schema: old.manifest,
  adapter: {
    hydrate: async () => [{ id: old.id, revision: 0 }],
    subscribe: (_scope, listener) => {
      publish = listener
      return () => {}
    },
    write: async () => {
      throw new Error('read benchmark')
    },
  },
})
const hydrationStart = performance.now()
await service.prepare(old.refs)
const hydrationMs = performance.now() - hydrationStart
const store = service.bind(old.id, old.refs)
const cachedStart = performance.now()
for (let count = 0; count < 100000; count++) store.get('selection')
const cachedReadMicroseconds = ((performance.now() - cachedStart) * 1000) / 100000
let notifications = 0
for (let count = 0; count < 1000; count++)
  store.subscribe('selection', () => {
    notifications++
  })
const notifyStart = performance.now()
publish({ id: old.id, revision: 1, value: { selection: { id: '42' } } })
const notify1000SubscribersMs = performance.now() - notifyStart
assert.equal(notifications, 1000)
service.dispose()
console.log(
  JSON.stringify(
    {
      frameworkBytes,
      esbuildVersion: requireBuild('esbuild/package.json').version,
      measurements,
      timing: {
        validation10000ItemsMs: validationMs,
        inProcessHydrationMs: hydrationMs,
        cachedReadMicroseconds,
        notify1000SubscribersMs,
      },
      budgets: {
        declarationBytesPerApp: DECLARATION_BYTES_PER_APP,
        contractCopiesPerRevisionPerContainer: 1,
        authoringValidatorsAfter: 0,
      },
    },
    null,
    2,
  ),
)
for (const measurement of measurements)
  assert.ok(
    measurement.afterParsedJs.raw <=
      DECLARATION_BYTES_PER_APP * (measurement.name === 'one-app' ? 1 : 2),
  )
