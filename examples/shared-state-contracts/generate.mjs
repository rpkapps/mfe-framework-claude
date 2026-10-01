import { readFileSync, writeFileSync } from 'node:fs'
import ts from 'typescript'
import { format } from 'prettier'
import { compileSharedState } from '@company/mfe-build/shared-state'

const file = new URL('./src/index.ts', import.meta.url)
const source = ts.createSourceFile(
  file.pathname,
  readFileSync(file, 'utf8'),
  ts.ScriptTarget.Latest,
  true,
)
const declaration = source.statements.find(statement => ts.isVariableStatement(statement))
const expression = declaration?.declarationList.declarations[0]?.initializer
if (!expression) throw new Error('Export sharedStateSchema as a const declaration')
const schema = compileSharedState(expression, source)
for (const [name, value] of Object.entries({
  'schema.json': schema,
  'shared-state.manifest.json': { schemas: { sharedStateSchema: schema } },
  'release-policy.json': { schema, baselines: [] },
})) {
  const path = new URL(name, import.meta.url)
  const contents = await format(JSON.stringify(value), { parser: 'json' })
  if (readFileSyncIfPresent(path) !== contents) writeFileSync(path, contents)
}
function readFileSyncIfPresent(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw error
  }
}
