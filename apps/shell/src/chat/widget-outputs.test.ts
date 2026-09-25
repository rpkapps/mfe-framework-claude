import { describe, expect, it } from 'vitest'

import { WidgetOutputs } from './widget-outputs.ts'

describe('WidgetOutputs', () => {
  it('keeps the latest payload of each output, newest first, as one context entry', () => {
    const outputs = new WidgetOutputs()
    expect(outputs.context()).toEqual([])

    outputs.record('call-1', 'well-design', 'selected', { wellId: 'htdp', selected: true })
    outputs.record('call-2', 'fda-summary', 'opened', { fdaId: 'fda-1-2' })
    outputs.record('call-1', 'well-design', 'selected', { wellId: 'htdp', selected: false })

    const [entry] = outputs.context()
    const value = JSON.parse(entry?.value ?? '[]') as { widgetId: string; payload: unknown }[]
    expect(value.map(item => [item.widgetId, item.payload])).toEqual([
      ['well-design', { wellId: 'htdp', selected: false }],
      ['fda-summary', { fdaId: 'fda-1-2' }],
    ])

    outputs.clear()
    expect(outputs.context()).toEqual([])
  })

  it('leaves out the oldest outputs once the entry would be too long', () => {
    const outputs = new WidgetOutputs()
    for (let index = 0; index < 100; index += 1) {
      outputs.record(`call-${String(index)}`, 'w', 'changed', { note: 'x'.repeat(100) })
    }
    const [entry] = outputs.context()
    expect(entry?.value.length).toBeLessThanOrEqual(4096)
    expect(entry?.value).toContain('call-99')
  })
})
