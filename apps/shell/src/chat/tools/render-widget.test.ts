import type { RegistryEntry } from '@company/mfe-react'
import { describe, expect, it } from 'vitest'

import { readRenderWidgetInput, renderWidgetTool } from './render-widget.ts'

const call = { toolCallId: 'c', threadId: 't', runId: 'r', signal: new AbortController().signal }

const widget = (id: string, inputSchema?: object): RegistryEntry =>
  ({
    id,
    definitionKind: 'widget',
    adapter: 'react',
    manifestUrl: 'http://localhost/mf-manifest.json',
    title: id,
    ...(inputSchema === undefined
      ? {}
      : {
          contract: { inputSchema, outputSchema: { type: 'object', properties: { selected: {} } } },
        }),
  }) as unknown as RegistryEntry

const wellDesign = widget('well-design', {
  type: 'object',
  properties: { wellId: { enum: ['htdp'] } },
  required: ['wellId'],
})

describe('the render tool', () => {
  it('offers each Widget whose inputs are published, its schema a variant titled with its id', () => {
    const tool = renderWidgetTool([wellDesign, widget('no-contract')])

    expect(typeof tool?.followUp).toBe('function')
    expect(tool?.inputSchema).toMatchObject({
      properties: {
        widgetId: { enum: ['well-design'] },
        inputs: { anyOf: [{ title: 'well-design', required: ['wellId'] }] },
      },
    })
  })

  it('answers only that the Widget was shown, never its outputs', async () => {
    const tool = renderWidgetTool([wellDesign])
    const result: unknown = await tool?.execute(
      { widgetId: 'well-design', inputs: { wellId: 'htdp' } },
      call,
    )
    expect(result).toEqual({ status: 'shown', widgetId: 'well-design' })
    expect(JSON.stringify(tool?.inputSchema)).not.toContain('selected')
  })

  it('refuses a Widget it does not offer', async () => {
    const result: unknown = await renderWidgetTool([wellDesign])?.execute(
      { widgetId: 'other' },
      call,
    )
    expect(result).toMatchObject({ status: 'invalid' })
  })

  it('is not offered when no Widget publishes its inputs', () => {
    expect(renderWidgetTool([widget('no-contract')])).toBeUndefined()
  })
})

describe('readRenderWidgetInput', () => {
  it('reads the id and the inputs, as far as they have arrived', () => {
    expect(readRenderWidgetInput({ widgetId: 'w', inputs: { a: 1 } })).toEqual({
      widgetId: 'w',
      inputs: { a: 1 },
    })
    expect(readRenderWidgetInput({ widgetId: 'w' })).toEqual({ widgetId: 'w', inputs: {} })
    expect(readRenderWidgetInput({ inputs: {} })).toBeUndefined()
  })
})
