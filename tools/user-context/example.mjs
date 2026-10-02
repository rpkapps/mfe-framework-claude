/** Run after pnpm build: two independently compiled MFE contracts on one injected service. */
import assert from 'node:assert/strict'
import ts from 'typescript'
import {
  compileUserContext,
  compareContracts,
  requirementsFor,
} from '../../packages/mfe-build/dist/user-context/compiler.js'
import {
  createUserContextBackend,
  UserContextRuntime,
} from '../../packages/mfe-runtime/dist/user-context/index.js'

function compile(extra) {
  const file = ts.createSourceFile(
    'domain.ts',
    `import {z} from 'zod'; const userContextSchema=z.object({ 'selection': z.strictObject({wellId:z.string(),runId:z.string().nullable()${extra}}).nullable().default(null) });`,
    ts.ScriptTarget.Latest,
    true,
  )
  return compileUserContext(
    'well-selection',
    file.statements[1].declarationList.declarations[0].initializer,
    file,
  )
}
const v1 = compile('')
const v2 = compile(",comparisonMode:z.string().default('baseline')")
assert.deepEqual(compareContracts(v1.contracts[0], v2.contracts[0]), [])

// Example-only repository. A production repository implements an actual durable transaction.
const records = new Map()
const repository = {
  read: async (scope, id) => records.get(`${scope}/${id}`),
  transact: async (scope, id, update) => {
    const key = `${scope}/${id}`
    const next = update(records.get(key))
    records.set(key, next)
    return next
  },
}
const backend = createUserContextBackend({
  schema: v2,
  repository,
  resolveOwner: async () => 'well-selection',
  authorize: async scope => {
    assert.equal(scope, 'tenant/user/workspace')
  },
})
const service = new UserContextRuntime({
  scope: 'tenant/user/workspace',
  schema: v2,
  adapter: backend,
})
await service.prepare(requirementsFor(v1, 'well-selection'))
const oldMfe = service.bind(
  'well-selection',
  structuredClone(requirementsFor(v1, 'well-selection')),
)
const newMfe = service.bind(
  'well-selection',
  structuredClone(requirementsFor(v2, 'well-selection')),
)
const id = 'selection'
assert.equal(records.size, 0) // Reading a default does not persist anything.
assert.equal(
  (await newMfe.set(id, { wellId: 'well-42', runId: 'run-7', comparisonMode: 'overlay' })).ok,
  true,
)
await oldMfe.set(id, { wellId: 'well-42', runId: 'run-8' })
assert.deepEqual(oldMfe.get(id), { wellId: 'well-42', runId: 'run-8', comparisonMode: 'overlay' })
assert.deepEqual(newMfe.get(id), { wellId: 'well-42', runId: 'run-8', comparisonMode: 'overlay' })
console.log('Old MFE:', oldMfe.get(id))
console.log('New MFE:', newMfe.get(id))
console.log('Authoritative record:', [...records.values()][0].value)
await oldMfe.set(id, null)
assert.equal(newMfe.get(id), null)
service.dispose()
console.log('Mixed-version preservation, defaults and structural clearing passed.')
