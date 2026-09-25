/**
 * The chat's hooks, loaded with it (the boot path's are in `panel-hooks.ts`), apart from its
 * components so React Refresh can replace those in place (§18).
 */

import { useMemo, useSyncExternalStore } from 'react'
import type { ChatSnapshot } from '@company/mfe-agent'
import { toolNameOf } from '@company/mfe-agent/actions'
import { useMfeRuntime, type AgentSuggestionEntry } from '@company/mfe-react'
import type { MfeRuntime } from '@company/mfe-react/host'

import type { ShellChat } from './shell-chat.ts'
import type { PendingQuestion } from './tools/ask-user.ts'

const NO_QUESTIONS: ReadonlyMap<string, PendingQuestion> = new Map()
/** One action as the registry publishes it. */
export type ActionEntry = ReturnType<MfeRuntime['actions']['getSnapshot']>[number]

function useActions(): readonly ActionEntry[] {
  const runtime = useMfeRuntime('the chat')
  return useSyncExternalStore(
    runtime.actions.subscribe,
    runtime.actions.getSnapshot,
    runtime.actions.getSnapshot,
  )
}

/** What the page calls an action the agent can call, by tool name: its label, while it offers it. */
export function useActionLabel(toolName: string): string | undefined {
  return useActions().find(entry => toolNameOf(entry.id) === toolName)?.label
}

/** The actions the page offers the agent now, as its tools are chosen (`@company/mfe-agent`). */
export function useAgentActions(): readonly ActionEntry[] {
  const actions = useActions()
  return useMemo(
    () => actions.filter(entry => entry.placements.includes('agent') && entry.decision.allowed),
    [actions],
  )
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

const NONE_STOPPED: ReadonlySet<string> = new Set()

/** The messages a reply was stopped after. */
export function useStopped(chat: ShellChat): ReadonlySet<string> {
  return useSyncExternalStore(chat.stopped.subscribe, chat.stopped.getSnapshot, () => NONE_STOPPED)
}

/** What the chat's status region says now. */
export function useAnnouncement(chat: ShellChat): { readonly text: string; readonly key: number } {
  return useSyncExternalStore(
    chat.announcement.subscribe,
    chat.announcement.getSnapshot,
    chat.announcement.getSnapshot,
  )
}
