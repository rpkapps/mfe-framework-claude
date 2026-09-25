/**
 * The chat's hooks, loaded with it (the boot path's are in `panel-hooks.ts`), apart from its
 * components so React Refresh can replace those in place (§18).
 */

import { useSyncExternalStore } from 'react'
import type { ChatSnapshot } from '@company/mfe-agent'
import { toolNameOf } from '@company/mfe-agent/actions'
import { useMfeRuntime, type AgentSuggestionEntry } from '@company/mfe-react'

import type { ShellChat } from './shell-chat.ts'
import type { PendingQuestion } from './tools/ask-user.ts'

const NO_QUESTIONS: ReadonlyMap<string, PendingQuestion> = new Map()
/** What the page calls an action the agent can call, by tool name: its label, while it offers it. */
export function useActionLabel(toolName: string): string | undefined {
  const runtime = useMfeRuntime('the chat')
  const actions = useSyncExternalStore(
    runtime.actions.subscribe,
    runtime.actions.getSnapshot,
    runtime.actions.getSnapshot,
  )
  return actions.find(entry => toolNameOf(entry.id) === toolName)?.label
}

export function useChatSnapshot(chat: ShellChat): ChatSnapshot {
  return useSyncExternalStore(chat.client.subscribe, chat.client.getSnapshot)
}

export function useQuestions(chat: ShellChat): ReadonlyMap<string, PendingQuestion> {
  return useSyncExternalStore(
    chat.questions.subscribe,
    chat.questions.getSnapshot,
    () => NO_QUESTIONS,
  )
}

/** What the mounted Apps suggest, while they are mounted. */
export function useOfferedSuggestions(): readonly AgentSuggestionEntry[] {
  const { agentContext } = useMfeRuntime('the chat suggestions')
  return useSyncExternalStore(
    agentContext.subscribeSuggestions,
    agentContext.getSuggestions,
    agentContext.getSuggestions,
  )
}
