import { describe, expect, it } from 'vitest'
import { build } from 'esbuild'
import { ts } from '../discovery/ts-ast.ts'
import { compileUserContext, requirementsFor } from './compiler.ts'
import { transformUserContextSource } from './transform.ts'

describe('production user-context declarations', () => {
  it.each([false, true])(
    'removes schema-only dependencies from the emitted bundle graph (read-only: %s)',
    async readOnly => {
      const source = `import { z } from 'zod';
      import { createApp } from '@company/mfe-react';
      const schema = z.object({ selection: z.string().default('none') });
      export default createApp({ id: 'example', router: () => ({}), ${readOnly ? 'userContext: { reads: { producer: schema } }' : 'userContext: { schema }'} });`
      const file = ts.createSourceFile('mfe.ts', source, ts.ScriptTarget.Latest, true)
      const schema = (file.statements[2] as ts.VariableStatement).declarationList.declarations[0]!
        .initializer!
      const manifest = compileUserContext(readOnly ? 'producer' : 'example', schema, file)
      const result = await build({
        stdin: {
          contents: transformUserContextSource(source, 'mfe.ts', {
            example: requirementsFor(manifest, 'example'),
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
      expect(result.outputFiles[0]!.text).toContain('ownerId:"example"')
      expect(result.outputFiles[0]!.text).toContain(`id:"${readOnly ? 'producer' : 'example'}"`)
      expect(result.outputFiles[0]!.text).not.toMatch(
        /zod|userContextSchema|userContextReads|compileUserContext/,
      )
      expect(Object.keys(result.metafile.inputs)).toEqual(['<stdin>'])
      expect(Object.values(result.metafile.outputs)[0]!.imports.map(item => item.path)).toEqual([
        '@company/mfe-react',
      ])
    },
  )
})
