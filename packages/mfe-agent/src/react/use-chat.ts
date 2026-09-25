/**
 * `useChat`, following TanStack AI's React binding (`useChat` in `@tanstack/ai-react`,
 * https://github.com/TanStack/ai): the chat client for one component, its
 * snapshot as state, and its methods. The client lives as long as the component; options passed on
 * a later render are taken without rebuilding it.
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'

import { ChatClient } from '../chat-client.ts'
import type { ApprovalQuestion, ChatClientOptions, ChatSnapshot } from '../types.ts'
import type { Message } from '@ag-ui/core'

export interface UseChatReturn extends ChatSnapshot {
  sendMessage(content: string): Promise<void>
  reload(): Promise<void>
  stop(): void
  clear(): void
  setMessages(messages: readonly Message[]): void
  /** For the action pipeline's approver: `approvalsIn(requestApproval)`. */
  requestApproval(question: ApprovalQuestion): Promise<boolean>
}

export function useChat(options: ChatClientOptions): UseChatReturn {
  const [client] = useState(() => new ChatClient(options))

  useEffect(() => {
    client.updateOptions(options)
  })

  // Stopped, not disposed: under Strict Mode the effect runs again on the same client.
  useEffect(
    () => () => {
      client.stop()
    },
    [client],
  )

  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot)

  return useMemo(
    () => ({
      ...snapshot,
      sendMessage: client.sendMessage,
      reload: client.reload,
      stop: client.stop,
      clear: client.clear,
      setMessages: client.setMessages,
      requestApproval: client.requestApproval,
    }),
    [client, snapshot],
  )
}
