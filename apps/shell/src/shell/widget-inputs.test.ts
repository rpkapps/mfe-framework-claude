import { describe, expect, it } from 'vitest'

import { widgetInputsOnly } from './widget-inputs.ts'

describe('widgetInputsOnly', () => {
  it('keeps the inputs a Widget declares', () => {
    expect(widgetInputsOnly({ wellId: 'W-1', limit: 5, tags: ['a'] })).toEqual({
      wellId: 'W-1',
      limit: 5,
      tags: ['a'],
    })
  })

  it("drops every name that is one of DynamicWidget's own props", () => {
    const inputs = {
      wellId: 'W-1',
      widgetId: 'another-widget',
      instanceId: 'someone-elses-storage',
      inputFallback: 'not a function',
      fallback: null,
      pending: null,
      key: 'k',
      ref: null,
      children: 'x',
      onInputRejected: 'not a function',
      onOutput: 'not a function',
    }

    expect(widgetInputsOnly(inputs)).toEqual({ wellId: 'W-1' })
  })
})
