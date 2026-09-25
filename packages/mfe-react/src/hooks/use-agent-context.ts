/**
 * Agent context as hooks, scoped by component lifetime like actions: a selection belongs to its
 * mount, or to the host page outside one, and goes when the component unmounts or the mount is
 * disposed, so the agent never acts on a selection that is gone.
 */

import { useCallback, useEffect, useRef } from 'react'
import type { AgentContextRegistration, AgentPrompt, AgentSuggestion } from '@company/mfe-core'
import type { AgentContextHandle, AgentSuggestionsHandle } from '@company/mfe-runtime'
import type { z } from 'zod'

import { useOptionalMfeMount } from '../mount-context.tsx'
import { useMfeRuntime } from '../runtime-context.tsx'

/**
 * Publishes a small, typed snapshot of what is selected or focused, sent with each of the agent's
 * turns: ids and a short label, never whole records and never secrets. Call it with the current
 * value on every render; an equal value publishes nothing.
 */
export function useAgentContext<Schema extends z.ZodType>(
  registration: AgentContextRegistration<Schema>,
): void {
  const mount = useOptionalMfeMount()
  const { agentContext } = useMfeRuntime('useAgentContext()')
  const handle = useRef<AgentContextHandle | null>(null)
  const committed = useRef<AgentContextRegistration<Schema>>(registration)

  const definitionId = mount?.definitionId
  const mountToken = mount?.mountToken

  useEffect(() => {
    const registered =
      definitionId === undefined || mountToken === undefined
        ? agentContext.registerHost(committed.current)
        : agentContext.register({ definitionId, mountToken }, committed.current)
    handle.current = registered

    return () => {
      handle.current = null
      registered.remove()
    }
  }, [agentContext, definitionId, mountToken])

  // The store compares the parsed value and publishes nothing when only identity changed.
  useEffect(() => {
    committed.current = registration
    handle.current?.update(registration)
  })
}

/**
 * Returns a stable function that hands a prompt to the shell's chat, so a click becomes a chat
 * turn. It returns whether a chat took it; `false` means there is none, or the prompt was refused.
 */
export function useAgentPrompt(): (prompt: AgentPrompt) => boolean {
  const mount = useOptionalMfeMount()
  const { agentContext } = useMfeRuntime('useAgentPrompt()')
  const definitionId = mount?.definitionId

  return useCallback(
    (prompt: AgentPrompt) =>
      definitionId === undefined
        ? agentContext.prompt(prompt)
        : agentContext.prompt(prompt, definitionId),
    [agentContext, definitionId],
  )
}

/**
 * Offers prompts the chat shows as ways to start or carry on the conversation, while this
 * component is mounted: before the first message and after each answer. Pressed, a suggestion is
 * handed to the chat as `useAgentPrompt` hands one. Call it with the current list on every render;
 * an equal list publishes nothing. A mount offers at most three.
 */
export function useAgentSuggestions(suggestions: readonly AgentSuggestion[]): void {
  const mount = useOptionalMfeMount()
  const { agentContext } = useMfeRuntime('useAgentSuggestions()')
  const handle = useRef<AgentSuggestionsHandle | null>(null)
  const committed = useRef(suggestions)

  const definitionId = mount?.definitionId
  const mountToken = mount?.mountToken

  useEffect(() => {
    const offered =
      definitionId === undefined || mountToken === undefined
        ? agentContext.suggestHost(committed.current)
        : agentContext.suggest({ definitionId, mountToken }, committed.current)
    handle.current = offered

    return () => {
      handle.current = null
      offered.remove()
    }
  }, [agentContext, definitionId, mountToken])

  useEffect(() => {
    committed.current = suggestions
    handle.current?.update(suggestions)
  })
}
