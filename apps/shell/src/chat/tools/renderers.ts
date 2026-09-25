/**
 * The built-in renderers: a table, a chart and a summary card, for data the agent already has
 * from a tool or the context. A result renders as UI only because the tool says so, never by
 * guessing from the shape of data, and never as HTML from a result. Each is for the user, so it
 * ends the turn (`followUp: false`), and none is a data source: the descriptions say not to show
 * figures that came from nowhere.
 */

import type { ChatTool } from '@company/mfe-agent'
import { z } from 'zod'

import { SHELL_TOOLS } from './names.ts'

const cell = z.union([z.string(), z.number(), z.boolean(), z.null()])

export const TableInput = z.object({
  title: z.string().max(120).optional(),
  columns: z
    .array(
      z.object({
        key: z.string().min(1),
        label: z.string().min(1),
        align: z.enum(['start', 'end']).optional(),
      }),
    )
    .min(1)
    .max(12),
  rows: z.array(z.record(z.string(), cell)).max(200),
  caption: z.string().max(280).optional(),
})
export type TableInput = z.infer<typeof TableInput>

export const ChartInput = z.object({
  title: z.string().max(120).optional(),
  kind: z.enum(['bar', 'line']),
  x: z.object({ key: z.string().min(1), label: z.string().min(1) }),
  series: z
    .array(z.object({ key: z.string().min(1), label: z.string().min(1) }))
    .min(1)
    .max(6),
  data: z.array(z.record(z.string(), cell)).min(1).max(200),
  caption: z.string().max(280).optional(),
})
export type ChartInput = z.infer<typeof ChartInput>

export const SummaryInput = z.object({
  title: z.string().min(1).max(120),
  summary: z.string().max(600).optional(),
  facts: z
    .array(
      z.object({
        label: z.string().min(1).max(80),
        value: z.string().max(200),
        tone: z.enum(['default', 'success', 'warning', 'destructive']).optional(),
      }),
    )
    .max(12),
})
export type SummaryInput = z.infer<typeof SummaryInput>

export type RendererResult =
  { readonly status: 'shown' } | { readonly status: 'invalid'; readonly error: string }

const NOT_A_SOURCE =
  'Only with values you got from a tool or the context: never invent figures to fill it.'

function rendererTool(name: string, description: string, schema: z.ZodType): ChatTool {
  return {
    name,
    description: `${description} ${NOT_A_SOURCE} It is for the user, so the turn ends with it.`,
    inputSchema: z.toJSONSchema(schema),
    // Shown, the turn ends; refused, the agent hears why and can correct the call.
    followUp: result => (result as RendererResult).status !== 'shown',
    execute: (input): RendererResult => {
      const parsed = schema.safeParse(input)
      return parsed.success
        ? { status: 'shown' }
        : { status: 'invalid', error: z.prettifyError(parsed.error) }
    },
  }
}

export function rendererTools(): ChatTool[] {
  return [
    rendererTool(
      SHELL_TOOLS.table,
      'Show rows of data as a table in the chat, with the columns in order.',
      TableInput,
    ),
    rendererTool(
      SHELL_TOOLS.chart,
      'Show numbers as a bar or line chart in the chat: one row of `data` per x value, one number per series key.',
      ChartInput,
    ),
    rendererTool(
      SHELL_TOOLS.summary,
      'Show a summary card in the chat: a title, a sentence or two, and labelled facts.',
      SummaryInput,
    ),
  ]
}
