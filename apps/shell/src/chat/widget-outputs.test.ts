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

  it('forgets the outputs of Widgets whose calls left the history', () => {
    const outputs = new WidgetOutputs()
    outputs.record('call-1', 'well-design', 'selected', { wellId: 'htdp' })
    outputs.record('call-2', 'fda-summary', 'opened', { fdaId: 'fda-1-2' })

    outputs.prune(new Set(['call-1']))

    expect(outputs.context()[0]?.value).toContain('well-design')
    expect(outputs.context()[0]?.value).not.toContain('fda-summary')
    outputs.prune(new Set())
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

  it('leaves out a payload that is not JSON, and an entry too long to fit at all', () => {
    const outputs = new WidgetOutputs()
    const cycle: Record<string, unknown> = {}
    cycle['self'] = cycle
    outputs.record('call-1', 'w', 'kept', { ok: true })
    outputs.record('call-2', 'w', 'cyclic', cycle)
    outputs.record('call-3', 'w', 'huge', 'x'.repeat(5000))

    const [entry] = outputs.context()
    const value = JSON.parse(entry?.value ?? '[]') as { output: string }[]
    expect(value.map(item => item.output)).toEqual(['kept'])
  })
})
