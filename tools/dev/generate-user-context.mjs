import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { format } from 'prettier'
import { compileUserContext } from '../../packages/mfe-build/dist/user-context/compiler.js'

/** Each MFE publishes its own canonical contracts; the demo host only aggregates them. */
const directory = resolve(process.argv[2] ?? '.')
const file = resolve(directory, 'src/user-context.schema.ts')
const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
const owners = directory.endsWith('/lab')
  ? { userContextSchema: 'lab' }
  : { inspectionUserContextSchema: 'well-inspection', fieldworkUserContextSchema: 'fieldwork' }
const contracts = []
for (const statement of source.statements) {
  if (!ts.isVariableStatement(statement)) continue
  for (const declaration of statement.declarationList.declarations) {
    const owner = owners[declaration.name.getText(source)]
    if (owner && declaration.initializer)
      contracts.push(...compileUserContext(owner, declaration.initializer, source).contracts)
  }
}
if (contracts.length !== Object.keys(owners).length) throw new Error('Missing owner schema')
writeFileSync(
  resolve(directory, 'user-context.schema.json'),
  await format(JSON.stringify({ formatVersion: 1, contracts }), { parser: 'json' }),
)
