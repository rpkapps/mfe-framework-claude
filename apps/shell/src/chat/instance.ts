/**
 * The page's one chat, set at boot, as module state rather than context because there is exactly
 * one shell per document (like `shellUi`). Null when no agent backend is configured (`AGENT_URL`),
 * and the panel says so rather than the button disappearing.
 */

import type { ShellChat } from './shell-chat.ts'

let current: ShellChat | null = null

export function installShellChat(chat: ShellChat | null): void {
  current?.dispose()
  current = chat
}

export function shellChat(): ShellChat | null {
  return current
}
