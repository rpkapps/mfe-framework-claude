import { describe, expect, it } from 'vitest'

import { rendererTools } from './renderers.ts'

const call = { toolCallId: 'c', threadId: 't', runId: 'r', signal: new AbortController().signal }

describe('the built-in renderers', () => {
  const tools = new Map(rendererTools().map(tool => [tool.name, tool]))

  it('are a table, a chart and a summary, each ending the turn and warning off made-up figures', () => {
    expect([...tools.keys()]).toEqual(['show_table', 'show_chart', 'show_summary'])
    for (const tool of tools.values()) {
      expect(tool.followUp).toBe(false)
      expect(tool.description).toContain('never invent figures')
      expect(tool.inputSchema).toMatchObject({ type: 'object' })
    }
  })

  it('answer shown for inputs their schema accepts, and why not otherwise', async () => {
    const table = tools.get('show_table')
    expect(
      await table?.execute({ columns: [{ key: 'id', label: 'Id' }], rows: [{ id: 'W-1' }] }, call),
    ).toEqual({ status: 'shown' })
    expect(await table?.execute({ columns: [], rows: [] }, call)).toMatchObject({
      status: 'invalid',
    })
  })
})
