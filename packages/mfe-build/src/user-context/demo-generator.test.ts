import { readFileSync } from 'node:fs'
import { posix, resolve, win32 } from 'node:path'
import { runInNewContext } from 'node:vm'
import { format } from 'prettier'
import { describe, expect, it } from 'vitest'
import { ts } from '../discovery/ts-ast.ts'
import { compileUserContext } from './compiler.ts'

const repository = resolve(import.meta.dirname, '../../../..')
const scriptPath = resolve(repository, 'tools/dev/generate-user-context.mjs')
const script = ts.transpileModule(readFileSync(scriptPath, 'utf8'), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText

/** Execute the real entry point with each platform's path implementation, even on Linux CI. */
async function generate(path: typeof posix, directory: string, schema: string) {
  const writes = new Map<string, string>()
  const imports: Record<string, unknown> = {
    'node:path': path,
    'node:fs': {
      readFileSync(file: string, encoding: string) {
        expect(file).toBe(path.resolve(directory, 'src/user-context.schema.ts'))
        expect(encoding).toBe('utf8')
        return schema
      },
      writeFileSync(file: string, contents: string) {
        writes.set(file, contents)
      },
    },
    typescript: ts,
    prettier: { format },
    '../../packages/mfe-build/dist/user-context/compiler.js': { compileUserContext },
  }
  await (runInNewContext(`(async () => { ${script}\n })()`, {
    exports: {},
    process: { argv: ['node', scriptPath, directory] },
    require(id: string) {
      if (!(id in imports)) throw new Error(`Unexpected generator dependency: ${id}`)
      return imports[id]
    },
  }) as Promise<void>)
  expect([...writes.keys()]).toEqual([path.resolve(directory, 'user-context.schema.json')])
  return JSON.parse([...writes.values()][0]!) as unknown
}

const platforms = [
  { name: 'Windows', path: win32, root: 'C:\\Users\\developer\\Projects\\mfe-framework-claude' },
  { name: 'POSIX', path: posix, root: '/home/developer/Projects/mfe-framework-claude' },
]

describe.each(platforms)('demo user-context generation on $name', ({ path, root }) => {
  it.each(['lab', 'fieldwork'])('compiles the actual %s owner schemas', async example => {
    const exampleRoot = resolve(repository, 'examples', example)
    const schema = readFileSync(resolve(exampleRoot, 'src/user-context.schema.ts'), 'utf8')
    const expected = JSON.parse(
      readFileSync(resolve(exampleRoot, 'user-context.schema.json'), 'utf8'),
    ) as unknown
    const generated = await generate(path, path.resolve(root, 'examples', example), schema)
    expect(generated).toEqual(expected)
  })

  it('rejects a missing owner schema instead of publishing an incomplete manifest', async () => {
    await expect(
      generate(path, path.resolve(root, 'examples', 'lab'), 'export const unrelated = {}'),
    ).rejects.toThrow('Missing owner schema')
  })
})
