import { render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState, type ReactNode } from 'react'
import { HOST_SCOPE } from '@company/mfe-core'
import { z } from 'zod'

import { MfeProvider } from '../runtime-context.tsx'
import { createMfeTestEnvironment, type MfeTestEnvironment } from '../testing/index.tsx'
import { useAgentContext, useAgentPrompt, useAgentSuggestions } from './use-agent-context.ts'

let environment: MfeTestEnvironment | null = null

afterEach(async () => {
  const current = environment
  environment = null
  await current?.dispose()
})

const selection = z.object({ ids: z.array(z.string()) })

describe('useAgentContext', () => {
  it('publishes the mount’s selection, follows it, and takes it away on unmount', async () => {
    environment = createMfeTestEnvironment({ definitionId: 'operations' })
    const created = environment
    const Mounted = created.wrapper

    function Wells(): ReactNode {
      const [ids, setIds] = useState(['W-1'])
      useAgentContext({ description: 'The selected wells', schema: selection, value: { ids } })
      return (
        <button
          type="button"
          onClick={() => {
            setIds(['W-1', 'W-2'])
          }}
        >
          add
        </button>
      )
    }

    const view = render(
      <Mounted>
        <Wells />
      </Mounted>,
    )
    expect(created.runtime.agentContext.getSnapshot()).toMatchObject([
      { definitionId: 'operations', description: 'The selected wells', value: { ids: ['W-1'] } },
    ])

    view.getByRole('button').click()
    await waitFor(() => {
      expect(created.runtime.agentContext.getSnapshot()[0]?.value).toEqual({ ids: ['W-1', 'W-2'] })
    })

    view.unmount()
    expect(created.runtime.agentContext.getSnapshot()).toEqual([])
  })

  it('publishes nothing when a render passes an equal value', () => {
    environment = createMfeTestEnvironment({ definitionId: 'operations' })
    const created = environment
    const Mounted = created.wrapper

    function Wells(): ReactNode {
      useAgentContext({
        description: 'The selected wells',
        schema: selection,
        value: { ids: ['W-1'] },
      })
      return null
    }
    const view = render(
      <Mounted>
        <Wells />
      </Mounted>,
    )
    const first = created.runtime.agentContext.getSnapshot()
    view.rerender(
      <Mounted>
        <Wells />
      </Mounted>,
    )

    expect(created.runtime.agentContext.getSnapshot()).toBe(first)
  })

  it('publishes in the host scope outside a mount', () => {
    environment = createMfeTestEnvironment({ definitionId: 'shell' })
    const created = environment

    function Chrome(): ReactNode {
      useAgentContext({ description: 'The open dashboard', schema: z.string(), value: 'Main' })
      return null
    }
    render(
      <MfeProvider runtime={created.runtime}>
        <Chrome />
      </MfeProvider>,
    )

    expect(created.runtime.agentContext.getSnapshot()[0]?.definitionId).toBe(HOST_SCOPE)
  })
})

describe('useAgentPrompt', () => {
  it('hands the prompt to the chat, saying which definition asked', () => {
    environment = createMfeTestEnvironment({ definitionId: 'operations' })
    const created = environment
    const Mounted = created.wrapper
    const handler = vi.fn()
    created.runtime.agentContext.setPromptHandler(handler)
    const answers: boolean[] = []

    function Ask(): ReactNode {
      const prompt = useAgentPrompt()
      return (
        <button
          type="button"
          onClick={() => {
            answers.push(prompt({ message: 'Why is W-1 down?', context: { id: 'W-1' } }))
          }}
        >
          ask
        </button>
      )
    }
    const view = render(
      <Mounted>
        <Ask />
      </Mounted>,
    )
    view.getByRole('button').click()

    expect(answers).toEqual([true])
    expect(handler).toHaveBeenCalledWith({
      message: 'Why is W-1 down?',
      context: { id: 'W-1' },
      submit: true,
      definitionId: 'operations',
    })
  })
})

describe('useAgentSuggestions', () => {
  it('offers the mount’s suggestions, follows them, and takes them away on unmount', async () => {
    environment = createMfeTestEnvironment({ definitionId: 'operations' })
    const created = environment
    const Mounted = created.wrapper

    function Suggest(): ReactNode {
      const [message, setMessage] = useState('Which well is down?')
      useAgentSuggestions([{ message }])
      return (
        <button
          type="button"
          onClick={() => {
            setMessage('Which well is next?')
          }}
        >
          change
        </button>
      )
    }
    const view = render(
      <Mounted>
        <Suggest />
      </Mounted>,
    )
    const { agentContext } = created.runtime
    expect(agentContext.getSuggestions()).toEqual([
      { definitionId: 'operations', message: 'Which well is down?', submit: true },
    ])

    view.getByRole('button').click()
    await waitFor(() => {
      expect(agentContext.getSuggestions()[0]?.message).toBe('Which well is next?')
    })

    view.unmount()
    expect(agentContext.getSuggestions()).toEqual([])
  })
})
