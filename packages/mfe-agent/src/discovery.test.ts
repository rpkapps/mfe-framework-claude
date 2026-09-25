import { describe, expect, it, vi } from 'vitest'

import { DISCOVER_TOOLS, withToolDiscovery } from './discovery.ts'
import type { ChatTool } from './types.ts'

function tools(count: number): ChatTool[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `app__action-${String(index)}`,
    description: `Does thing ${String(index)}. More detail the list leaves out.`,
    inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
    execute: () => index,
  }))
}

const call = { toolCallId: 'call-1', runId: 'run-1', signal: new AbortController().signal }

describe('withToolDiscovery', () => {
  it('declares every tool while there are few', () => {
    const list = withToolDiscovery(() => tools(3), { threshold: 3 })
    expect(list({ threadId: 't' }).map(tool => tool.name)).toHaveLength(3)
  })

  it('above the threshold declares the eager tools and one discovery tool naming the rest', () => {
    const list = withToolDiscovery(() => tools(5), {
      threshold: 3,
      eager: tool => tool.name === 'app__action-0',
    })

    const declared = list({ threadId: 't' })

    expect(declared.map(tool => tool.name)).toEqual(['app__action-0', DISCOVER_TOOLS])
    const discover = declared[1]
    expect(discover?.description).toContain('- app__action-4: Does thing 4.')
    expect(discover?.description).not.toContain('More detail')
    expect(discover?.description).not.toContain('app__action-0')
  })

  it('returns the definitions asked for and declares them from then on, per conversation', async () => {
    const source = vi.fn(() => tools(5))
    const list = withToolDiscovery(source, { threshold: 3 })
    const discover = list({ threadId: 't' }).find(tool => tool.name === DISCOVER_TOOLS)

    const result: unknown = await discover?.execute(
      { names: ['app__action-2', 'gone'] },
      { ...call, threadId: 't' },
    )

    expect(result).toEqual({
      tools: [
        {
          name: 'app__action-2',
          description: 'Does thing 2. More detail the list leaves out.',
          inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
        },
      ],
      unknown: ['gone'],
    })
    expect(list({ threadId: 't' }).map(tool => tool.name)).toEqual([
      'app__action-2',
      DISCOVER_TOOLS,
    ])
    expect(list({ threadId: 'other' }).map(tool => tool.name)).toEqual([DISCOVER_TOOLS])
  })

  it('drops the discovery tool once every tool is declared', async () => {
    const list = withToolDiscovery(() => tools(4), { threshold: 3 })
    const discover = list({ threadId: 't' }).find(tool => tool.name === DISCOVER_TOOLS)

    await discover?.execute({ names: tools(4).map(tool => tool.name) }, { ...call, threadId: 't' })

    expect(list({ threadId: 't' }).map(tool => tool.name)).not.toContain(DISCOVER_TOOLS)
  })
})
