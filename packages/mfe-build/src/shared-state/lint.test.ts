import { expect, it } from 'vitest'
import { sharedStateRule } from './lint.ts'

it('reports unsupported authoring expressions with source locations in editor diagnostics', () => {
  const reports: { loc: { line: number; column: number }; message: string }[] = []
  sharedStateRule()
    .create({
      filename: 'mfe.ts',
      sourceCode: {
        text: `import {z} from 'zod'; import {createApp} from '@company/mfe-react';
    const app = createApp({ sharedStateSchema: z.object({ selection: z.string().transform(value => value) }) });`,
      },
      report: report => reports.push(report),
    })
    .Program()
  expect(reports).toHaveLength(1)
  expect(reports[0]!.loc.line).toBe(2)
  expect(reports[0]!.message).toMatch(/transform/)
})

it('leaves supported declarations clean without requiring a release policy in the editor', () => {
  const reports: unknown[] = []
  sharedStateRule()
    .create({
      filename: 'mfe.ts',
      sourceCode: {
        text: `import {z} from 'zod'; import {createApp} from '@company/mfe-react'; const app = createApp({ sharedStateSchema: z.object({ selection: z.string().default('none') }) });`,
      },
      report: report => reports.push(report),
    })
    .Program()
  expect(reports).toEqual([])
})
