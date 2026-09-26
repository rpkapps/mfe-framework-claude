import { Component, EventEmitter, Input, Output } from '@angular/core'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { createWidget } from '../definition.ts'
import { readComponentContract } from './component-contract.ts'

@Component({ selector: 'test-alert', template: '' })
class AlertComponent {
  @Input() alertId = ''
  @Output() readonly acknowledged = new EventEmitter<unknown>()
}

describe('reading a Widget’s component against its contract', () => {
  it('reflects a definition once, however many times it mounts', () => {
    const alert = createWidget({
      id: 'alert-panel',
      inputSchema: z.object({ alertId: z.string() }),
      outputSchema: z.object({ acknowledged: z.object({}) }),
      component: AlertComponent,
    })

    const first = readComponentContract(alert)

    expect(readComponentContract(alert)).toBe(first)
    expect([...first.inputs]).toEqual(['alertId'])
    expect([...first.outputs]).toEqual([['acknowledged', 'acknowledged']])
  })

  it('keeps nothing for a definition that fails, so it fails the same way every time', () => {
    const missing = createWidget({
      id: 'missing-input',
      inputSchema: z.object({ alertId: z.string(), title: z.string() }),
      outputSchema: z.object({}),
      component: AlertComponent,
    })

    expect(() => readComponentContract(missing)).toThrowError(/an input named "title"/)
    expect(() => readComponentContract(missing)).toThrowError(/an input named "title"/)
  })
})
