/**
 * The shell's chat: one conversation for the page, with the agent backend at `AGENT_URL`, through
 * `@company/mfe-agent` (§49). It lives outside React, for as long as the runtime, so closing the
 * panel or crossing the breakpoint between the aside and the sheet loses nothing.
 *
 * It is the host end of the agentic plan (E): the agent's tools are the page's actions, the
 * navigate tool from the published routes, the render tool from the published Widget contracts,
 * the built-in renderers and `ask_user`; the action pipeline's approvals are answered in the chat;
 * a mount's `useAgentPrompt` becomes a turn; and the page's agent context goes with every run. The
 * shell keeps no record of the conversation: the audit is the runtime's telemetry (§47).
 */

import {
  ChatClient,
  fetchServerSentEvents,
  withToolDiscovery,
  type ChatContext,
  type ChatTool,
} from '@company/mfe-agent'
import { actionTools, agentContextOf, approvalsIn } from '@company/mfe-agent/actions'
import { HOST_SCOPE, type AgentSuggestionEntry } from '@company/mfe-react'
import {
  listApps,
  listEntries,
  listWidgets,
  type ActionApprover,
  type AgentPromptRequest,
  type MfeRuntime,
} from '@company/mfe-react/host'

import { A2uiSurfaces } from './a2ui/surfaces.ts'
import { Store, type ChatPanel } from './panel.ts'
import { askUserTool, Questions } from './tools/ask-user.ts'
import { isShellTool } from './tools/names.ts'
import { navigateTool, type Go } from './tools/navigate.ts'
import { renderA2uiTool } from './tools/render-a2ui.ts'
import { renderWidgetTool } from './tools/render-widget.ts'
import { rendererTools } from './tools/renderers.ts'
import { WidgetOutputs } from './widget-outputs.ts'

/** What an A2UI Button sends back (A2UI v0.9 `action`). */
export interface A2uiUserAction {
  readonly name: string
  readonly surfaceId: string
  readonly sourceComponentId: string
  readonly timestamp: string
  readonly context: Readonly<Record<string, unknown>>
}

export interface ShellChatOptions {
  readonly runtime: MfeRuntime
  /** Where the agent backend takes AG-UI runs. */
  readonly url: string
  /** The request boundary's fetch, so the backend receives the user's token. */
  readonly fetch?: (url: string, init: RequestInit) => Promise<Response>
  readonly go: Go
  /** The panel's state, which lives on the boot path, before the chat loads (`LazyShellChat`). */
  readonly panel: ChatPanel
}

export class ShellChat {
  readonly client: ChatClient
  readonly questions = new Questions()
  readonly outputs = new WidgetOutputs()
  readonly a2ui = new A2uiSurfaces()
  /** What the chat's one polite status region says; the key makes each a new announcement. */
  readonly announcement = new Store<{ readonly text: string; readonly key: number }>({
    text: '',
    key: 0,
  })
  /** The messages a reply was stopped after, so the transcript can say it did not finish. */
  readonly stopped = new Store<ReadonlySet<string>>(new Set())
  readonly panel: ChatPanel
  /** The router's navigation, asked of the Apps first: the navigate tool's, and a link's in a reply. */
  readonly go: Go
  /** The pipeline's approval step, asked in the chat, which opens to show the card. */
  readonly approve: ActionApprover

  readonly #runtime: MfeRuntime
  /** Replaced, not pushed to, so the composer sees a new list after each send. */
  #sent: readonly string[] = []

  constructor(options: ShellChatOptions) {
    const { runtime, panel } = options
    this.#runtime = runtime
    this.panel = panel
    this.go = options.go

    // The registry is read once at boot, so the shell's own tools are built once too.
    const shellTools = [
      navigateTool(listApps(runtime.registry), options.go),
      renderWidgetTool(listWidgets(runtime.registry)),
      ...rendererTools(),
      renderA2uiTool(this.a2ui),
      askUserTool(this.questions),
    ].filter((tool): tool is ChatTool => tool !== undefined)

    this.client = new ChatClient({
      connection: fetchServerSentEvents(options.url, {
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      }),
      // Actions come and go with their mounts, so they are listed again before every run.
      tools: withToolDiscovery(() => [...shellTools, ...actionTools(runtime.actions)], {
        eager: tool => isShellTool(tool.name),
      }),
      agentContext: () => [...agentContextOf(runtime.agentContext), ...this.outputs.context()],
    })

    this.approve = approvalsIn(question => {
      panel.show()
      return this.client.requestApproval(question)
    })
  }

  // ─── The conversation ─────────────────────────────────────────────────────

  /** Sends the user's message with the attachments, which are then cleared. */
  async send(text: string): Promise<void> {
    const { attachments } = this.panel.getSnapshot()
    const quotes = attachments.flatMap(item => (item.quote === undefined ? [] : [item.quote]))
    const context = attachments.flatMap(item => (item.context === undefined ? [] : [item.context]))
    const message = [...quotes, text].join('\n\n')
    if (message.trim() === '') return

    this.#sent = [...this.#sent, text]
    this.panel.clearComposer()
    await this.client.sendMessage(message, { context })
  }

  /** Says `text` in the chat's status region, once, even when it is what was said last. */
  announce(text: string): void {
    this.announcement.update(({ key }) => ({ text, key: key + 1 }))
  }

  /**
   * Stops the reply that is arriving, noting where: its last message, the reply itself or, when
   * nothing had arrived yet, the question.
   */
  readonly stop = (): void => {
    const last = this.client.getSnapshot().messages.at(-1)
    this.client.stop()
    if (last !== undefined) this.stopped.update(ids => new Set([...ids, last.id]))
  }

  /**
   * Replaces a question the user asked with `text` and asks again from there: the replies after it
   * go. A quote the question began with stays; what a page attached to it went with the first run.
   */
  async edit(messageId: string, quoted: string, text: string): Promise<void> {
    if (text.trim() === '') return
    this.#sent = [...this.#sent, text]
    await this.client.editMessage(messageId, quoted === '' ? text : `${quoted}\n\n${text}`)
  }

  /** What the user typed, oldest first, for the composer's ArrowUp and ArrowDown; kept across `/new`. */
  sent(): readonly string[] {
    return this.#sent
  }

  /** Starts over: a new thread, and nothing the old one showed stays in the agent context. */
  newConversation(): void {
    this.client.clear()
    this.outputs.clear()
    this.a2ui.clear()
    this.stopped.update(() => new Set())
    this.panel.clearComposer()
  }

  dispose(): void {
    this.client.dispose()
  }

  /**
   * A Button's event on an A2UI surface: a new turn from the user's press, which shows what they
   * pressed and sends the event unseen, both as context and in the form the AG-UI A2UI
   * middleware reads (`forwardedProps.a2uiAction.userAction`).
   */
  a2uiAction(action: A2uiUserAction, label: string): void {
    const described = `User performed action "${action.name}" on surface "${action.surfaceId}" (component: ${action.sourceComponentId}). Context: ${JSON.stringify(action.context)}`
    this.panel.show()
    void this.client.sendMessage(label.trim() === '' ? action.name : label, {
      context: [{ description: 'The A2UI action the user took', value: described }],
      forwardedProps: { a2uiAction: { userAction: action } },
    })
  }

  /** A suggestion the user pressed: handed on as the prompt of the mount that offered it. */
  offer(suggestion: AgentSuggestionEntry): void {
    this.prompt({
      message: suggestion.message,
      submit: suggestion.submit,
      definitionId: suggestion.definitionId,
      ...(suggestion.context === undefined ? {} : { context: suggestion.context }),
    })
  }

  /** A mount's `useAgentPrompt`: a click that becomes a turn, or a draft to review. */
  prompt(request: AgentPromptRequest): void {
    const who = this.#titleOf(request.definitionId)
    const context: ChatContext | undefined =
      request.context === undefined
        ? undefined
        : {
            description: `What ${who} attached to the user's message`,
            value: JSON.stringify(request.context),
          }

    if (request.submit) {
      this.panel.show()
      void this.client.sendMessage(request.message, {
        context: context === undefined ? [] : [context],
      })
      return
    }

    this.panel.setDraft(request.message)
    if (context !== undefined) {
      this.panel.attach({
        id: 'prompt-context',
        kind: 'context',
        label: `From ${who}`,
        description: 'Page context',
        context,
      })
    }
    this.panel.focus()
  }

  #titleOf(definitionId: string): string {
    if (definitionId === HOST_SCOPE) return 'the shell'
    const entry = listEntries(this.#runtime.registry).find(item => item.id === definitionId)
    return entry?.title ?? definitionId
  }
}
