/** The chat's hooks, apart from its components so React Refresh can replace those in place (§18). */

import { useSyncExternalStore } from 'react'
import type { ChatSnapshot } from '@company/mfe-agent'
import { useMfeRuntime, type AgentSuggestionEntry } from '@company/mfe-react'

import { shellChat } from './instance.ts'
import type { ChatPanelState, ShellChat } from './shell-chat.ts'
import type { PendingQuestion } from './tools/ask-user.ts'

const CLOSED: ChatPanelState = { open: false, draft: '', attachments: [], focusRequest: 0 }
const NO_QUESTIONS: ReadonlyMap<string, PendingQuestion> = new Map()
const noop = (): (() => void) => () => {}

export function useShellChat(): ShellChat | null {
  return shellChat()
}

export function useChatPanel(chat: ShellChat | null): ChatPanelState {
  return useSyncExternalStore(
    chat?.panel.subscribe ?? noop,
    chat?.panel.getSnapshot ?? (() => CLOSED),
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
