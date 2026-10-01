import { describe, expect, it } from 'vitest'
import { build } from 'esbuild'
import { ts } from '../discovery/ts-ast.ts'
import { compileSharedState, requirementsFor } from './compiler.ts'
import { transformSharedStateSource } from './transform.ts'

describe('production shared-state declarations', () => {
  it('removes schema-only dependencies from the emitted bundle graph', async () => {
    const source = `import { z } from 'zod';
      import { createApp } from '@company/mfe-react';
      const schema = z.object({ selection: z.string().default('none') });
      export default createApp({ id: 'example', router: () => ({}), sharedStateSchema: schema });`
    const file = ts.createSourceFile('mfe.ts', source, ts.ScriptTarget.Latest, true)
    const schema = (file.statements[2] as ts.VariableStatement).declarationList.declarations[0]!
      .initializer!
    const manifest = compileSharedState(schema, file)
    const result = await build({
      stdin: {
        contents: transformSharedStateSource(source, 'mfe.ts', {
          example: requirementsFor(manifest),
        }),
        loader: 'ts',
      },
      bundle: true,
      write: false,
      metafile: true,
      minify: true,
      format: 'esm',
      external: ['@company/mfe-react'],
    })
    expect(result.outputFiles[0]!.text).toContain(manifest.contracts[0]!.revision)
    expect(result.outputFiles[0]!.text).not.toMatch(/zod|sharedStateSchema|compileSharedState/)
    expect(Object.keys(result.metafile.inputs)).toEqual(['<stdin>'])
    expect(Object.values(result.metafile.outputs)[0]!.imports.map(item => item.path)).toEqual([
      '@company/mfe-react',
    ])
  })
})
