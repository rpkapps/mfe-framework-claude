import { Component, createEnvironmentInjector, runInInjectionContext, signal } from '@angular/core'
import { HOST_SCOPE } from '@company/mfe-core'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createWidget } from '../definition.ts'
import { createHostApplication, createMfeTestEnvironment, mountWidget } from '../testing/index.ts'
import { injectAgentContext, injectAgentPrompt } from './agent-context.ts'

@Component({ selector: 'test-empty', template: '' })
class EmptyComponent {}

const ordersWidget = createWidget({
  id: 'orders',
  inputSchema: z.object({}),
  outputSchema: z.object({}),
  component: EmptyComponent,
})

const selection = z.object({ ids: z.array(z.string()) })

describe('injectAgentContext', () => {
  it('publishes under the definition inside a mount', async () => {
    const widget = await mountWidget(ordersWidget)

    runInInjectionContext(widget.injector, () => {
      injectAgentContext({
        description: 'The selected orders',
        schema: selection,
        value: { ids: ['O-1'] },
      })
    })

    expect(widget.environment.runtime.agentContext.getSnapshot()).toMatchObject([
      { definitionId: 'orders', value: { ids: ['O-1'] } },
    ])
  })

  it('republishes when a signal the factory reads changes, and goes with its injector', async () => {
    const environment = createMfeTestEnvironment()
    const appRef = await createHostApplication(environment)
    const injector = createEnvironmentInjector([], appRef.injector)
    const ids = signal(['O-1'])

    runInInjectionContext(injector, () => {
      injectAgentContext(() => ({
        description: 'The selected orders',
        schema: selection,
        value: { ids: ids() },
      }))
    })
    await appRef.whenStable()
    const { agentContext } = environment.runtime
    expect(agentContext.getSnapshot()[0]).toMatchObject({ definitionId: HOST_SCOPE })

    ids.set(['O-1', 'O-2'])
    await appRef.whenStable()
    expect(agentContext.getSnapshot()[0]?.value).toEqual({ ids: ['O-1', 'O-2'] })

    injector.destroy()
    expect(agentContext.getSnapshot()).toEqual([])
    environment.dispose()
  })
})

describe('injectAgentPrompt', () => {
  it('hands the prompt to the chat, saying which definition asked', async () => {
    const widget = await mountWidget(ordersWidget)
    const handler = vi.fn()
    widget.environment.runtime.agentContext.setPromptHandler(handler)

    const prompt = runInInjectionContext(widget.injector, () => injectAgentPrompt())

    expect(prompt({ message: 'Why is O-1 late?', submit: false })).toBe(true)
    expect(handler).toHaveBeenCalledWith({
      message: 'Why is O-1 late?',
      submit: false,
      definitionId: 'orders',
    })
  })
})
