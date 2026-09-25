import { Component, Input } from '@angular/core'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { createWidget } from '../definition.ts'
import { config } from './generated/config.ts'
import { fetch } from './generated/fetch.ts'
import {
  cleanup,
  mfeRequests,
  mountWidget,
  resetGeneratedAliases,
  setMfeApiBaseUrl,
  setMfeConfig,
  setMfeFetch,
} from './index.ts'

@Component({ selector: 'test-greeting', template: '<p>hello {{ name }}</p>' })
class GreetingComponent {
  @Input() name = ''
}

const greeting = createWidget({
  id: 'greeting',
  inputSchema: z.object({ name: z.string() }),
  outputSchema: z.object({}),
  component: GreetingComponent,
})

describe('the testing helpers', () => {
  it('dispose a mount a test forgot, leaving the document and the runtime clean', async () => {
    const widget = await mountWidget(greeting, { inputs: { name: 'Ada' } })
    expect(document.body.textContent).toContain('hello Ada')

    await cleanup()

    expect(document.body.childElementCount).toBe(0)
    expect(widget.element.isConnected).toBe(false)
  })

  it('stand in for the generated configuration, failing loudly on anything unset', () => {
    expect(() => config['apiBaseUrl']).toThrowError(/Call setMfeConfig\(\{ apiBaseUrl: … \}\)/)

    setMfeConfig({ apiBaseUrl: 'https://api.example.test' })
    expect(config['apiBaseUrl']).toBe('https://api.example.test')
    expect(() => config['region']).toThrowError(/'region' among the installed values/)

    resetGeneratedAliases()
    expect(() => config['apiBaseUrl']).toThrowError(/nothing installed/)
  })

  it('stand in for the generated fetch, recording what went out with the session’s token', async () => {
    setMfeApiBaseUrl('https://api.example.test')
    setMfeFetch(() => new Response('{"ok":true}'))

    const response = await fetch('/orders')

    expect(await response.json()).toEqual({ ok: true })
    expect(mfeRequests()).toEqual([
      {
        url: 'https://api.example.test/orders',
        method: 'GET',
        authorization: 'Bearer test-access-token',
      },
    ])
  })
})
