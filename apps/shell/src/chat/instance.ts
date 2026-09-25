/**
 * The page's one chat, set at boot, as module state rather than context because there is exactly
 * one shell per document (like `shellUi`). Null when no agent backend is configured (`AGENT_URL`),
 * and the panel says so rather than the button disappearing.
 *
 * Only the panel's state is on the boot path. The conversation, its tools and the agent client
 * (`ShellChat`, with `@ag-ui/client` and the tools' schemas) load on first use: the panel opening,
 * or a mount's prompt, which is taken at once and handed on once the chat has loaded.
 */

import type { AgentPromptRequest } from '@company/mfe-react/host'

import { ChatPanel } from './panel.ts'
import type { ShellChat, ShellChatOptions } from './shell-chat.ts'

export type LazyShellChatOptions = Omit<ShellChatOptions, 'panel'>

export class LazyShellChat {
  readonly panel = new ChatPanel()
  readonly #options: LazyShellChatOptions
  readonly #cleanup: readonly (() => void)[]
  #loading: Promise<ShellChat> | undefined
  #chat: ShellChat | undefined
  #disposed = false

  constructor(options: LazyShellChatOptions) {
    this.#options = options
    const { actions, agentContext } = options.runtime
    // Both set before the chat has loaded, so neither a page's prompt nor an approval finds no
    // chat to take it; each loads the chat.
    this.#cleanup = [
      agentContext.setPromptHandler(request => {
        this.#prompt(request)
      }),
      actions.setApprover(async request => await (await this.load()).approve(request)),
    ]
  }

  /** The conversation, created once its code has loaded; a load that fails is tried again. */
  load(): Promise<ShellChat> {
    this.#loading ??= this.#create().catch((cause: unknown) => {
      this.#loading = undefined
      throw cause
    })
    return this.#loading
  }

  /**
   * Starts loading ahead of use: as the pointer or focus reaches the Assistant button, and as the
   * panel first renders, so the conversation and the panel's code download side by side.
   */
  preload(): void {
    // A failure is said when the chat is used; a prefetch has nobody to tell.
    this.load().catch(() => undefined)
    import('./chat-panel.tsx').catch(() => undefined)
  }

  dispose(): void {
    this.#disposed = true
    for (const cleanup of this.#cleanup) cleanup()
    this.#chat?.dispose()
  }

  async #create(): Promise<ShellChat> {
    const { ShellChat: Chat } = await import('./shell-chat.ts')
    if (this.#disposed) throw new Error('The chat was replaced before it loaded.')
    this.#chat = new Chat({ ...this.#options, panel: this.panel })
    return this.#chat
  }

  /** A mount's `useAgentPrompt`: the panel opens at once, and the chat takes it once loaded. */
  #prompt(request: AgentPromptRequest): void {
    this.panel.show()
    this.load().then(
      chat => {
        chat.prompt(request)
      },
      () => {
        // The panel, open now, says the chat could not be loaded.
      },
    )
  }
}

let current: LazyShellChat | null = null

/** Boot runs again on a hot reload, so the chat it replaces lets go of the runtime first. */
export function installShellChat(chat: LazyShellChat | null): void {
  current?.dispose()
  current = chat
}

export function shellChat(): LazyShellChat | null {
  return current
}
