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
  type AgentPromptRequest,
  type MfeRuntime,
} from '@company/mfe-react/host'

import { A2uiSurfaces } from './a2ui/surfaces.ts'
import { quote } from './quote.ts'
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

/** What goes with the next message besides its text, shown as a chip the user can remove. */
export interface ChatAttachment {
  readonly id: string
  readonly label: string
  readonly description: string
  /** Quoted in the message itself, so it stays in the conversation: the text the user selected. */
  readonly quote?: string
  /** Sent as the turn's AG-UI context and not shown: what a page attached to a prompt. */
  readonly context?: ChatContext
}

export interface ChatPanelState {
  readonly open: boolean
  readonly draft: string
  readonly attachments: readonly ChatAttachment[]
  /** Bumped to ask the composer for focus, which only the rendered panel can give. */
  readonly focusRequest: number
}

export interface ShellChatOptions {
  readonly runtime: MfeRuntime
  /** Where the agent backend takes AG-UI runs. */
  readonly url: string
  /** The request boundary's fetch, so the backend receives the user's token. */
  readonly fetch?: (url: string, init: RequestInit) => Promise<Response>
  readonly go: Go
}

/** A minimal external store, for `useSyncExternalStore`. */
class Store<T> {
  #value: T
  readonly #listeners = new Set<() => void>()

  constructor(value: T) {
    this.#value = value
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  readonly getSnapshot = (): T => this.#value

  update(change: (value: T) => T): void {
    const next = change(this.#value)
    if (next === this.#value) return
    this.#value = next
    for (const listener of this.#listeners) listener()
  }
}

export class ShellChat {
  readonly client: ChatClient
  readonly questions = new Questions()
  readonly outputs = new WidgetOutputs()
  readonly a2ui = new A2uiSurfaces()
  readonly panel = new Store<ChatPanelState>({
    open: false,
    draft: '',
    attachments: [],
    focusRequest: 0,
  })

  readonly #runtime: MfeRuntime
  readonly #sent: string[] = []
  readonly #cleanup: (() => void)[] = []

  constructor(options: ShellChatOptions) {
    const { runtime } = options
    this.#runtime = runtime

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

    // The pipeline's approval step asks in the chat, which opens to show the card.
    runtime.actions.setApprover(
      approvalsIn(question => {
        this.show()
        return this.client.requestApproval(question)
      }),
    )
    this.#cleanup.push(
      runtime.agentContext.setPromptHandler(request => {
        this.#prompt(request)
      }),
    )
  }

  // ─── The panel ────────────────────────────────────────────────────────────

  show(): void {
    this.panel.update(state => (state.open ? state : { ...state, open: true }))
  }

  hide(): void {
    this.panel.update(state => (state.open ? { ...state, open: false } : state))
  }

  toggle(): void {
    this.panel.update(state => ({ ...state, open: !state.open }))
  }

  /** Opens the panel and puts the caret in the composer. */
  focus(): void {
    this.panel.update(state => ({ ...state, open: true, focusRequest: state.focusRequest + 1 }))
  }

  setDraft(draft: string): void {
    this.panel.update(state => (state.draft === draft ? state : { ...state, draft }))
  }

  attach(attachment: ChatAttachment): void {
    this.panel.update(state => ({
      ...state,
      attachments: [...state.attachments.filter(item => item.id !== attachment.id), attachment],
    }))
  }

  detach(id: string): void {
    this.panel.update(state => ({
      ...state,
      attachments: state.attachments.filter(item => item.id !== id),
    }))
  }

  /**
   * The text the user selected on the page, quoted into their next message (agentic plan, B):
   * the shell's ⌘I. With no selection it only opens the chat.
   */
  askAbout(selection: string): void {
    const text = selection.trim()
    if (text !== '') {
      this.attach({
        id: 'selection',
        label: 'Selected text',
        description: text.length > 80 ? `${text.slice(0, 80)}…` : text,
        quote: quote(text),
      })
    }
    this.focus()
  }

  // ─── The conversation ─────────────────────────────────────────────────────

  /** Sends the user's message with the attachments, which are then cleared. */
  async send(text: string): Promise<void> {
    const { attachments } = this.panel.getSnapshot()
    const quotes = attachments.flatMap(item => (item.quote === undefined ? [] : [item.quote]))
    const context = attachments.flatMap(item => (item.context === undefined ? [] : [item.context]))
    const message = [...quotes, text].join('\n\n')
    if (message.trim() === '') return

    this.#sent.push(text)
    this.panel.update(state => ({ ...state, draft: '', attachments: [] }))
    await this.client.sendMessage(message, { context })
  }

  /** The last message the user typed, for ArrowUp in an empty composer. */
  lastSent(): string | undefined {
    return this.#sent.at(-1)
  }

  /** Starts over: a new thread, and nothing the old one showed stays in the agent context. */
  newConversation(): void {
    this.client.clear()
    this.outputs.clear()
    this.a2ui.clear()
    this.panel.update(state => ({ ...state, draft: '', attachments: [] }))
  }

  dispose(): void {
    this.client.dispose()
    for (const cleanup of this.#cleanup.splice(0)) cleanup()
  }

  /**
   * A Button's event on an A2UI surface: a new turn from the user's press, which shows what they
   * pressed and sends the event unseen, both as context and in the form the AG-UI A2UI
   * middleware reads (`forwardedProps.a2uiAction.userAction`).
   */
  a2uiAction(action: A2uiUserAction, label: string): void {
    const described = `User performed action "${action.name}" on surface "${action.surfaceId}" (component: ${action.sourceComponentId}). Context: ${JSON.stringify(action.context)}`
    this.show()
    void this.client.sendMessage(label.trim() === '' ? action.name : label, {
      context: [{ description: 'The A2UI action the user took', value: described }],
      forwardedProps: { a2uiAction: { userAction: action } },
    })
  }

  /** A suggestion the user pressed: handed on as the prompt of the mount that offered it. */
  offer(suggestion: AgentSuggestionEntry): void {
    this.#prompt({
      message: suggestion.message,
      submit: suggestion.submit,
      definitionId: suggestion.definitionId,
      ...(suggestion.context === undefined ? {} : { context: suggestion.context }),
    })
  }

  /** A mount's `useAgentPrompt`: a click that becomes a turn, or a draft to review. */
  #prompt(request: AgentPromptRequest): void {
    const who = this.#titleOf(request.definitionId)
    const context: ChatContext | undefined =
      request.context === undefined
        ? undefined
        : {
            description: `What ${who} attached to the user's message`,
            value: JSON.stringify(request.context),
          }

    if (request.submit) {
      this.show()
      void this.client.sendMessage(request.message, {
        context: context === undefined ? [] : [context],
      })
      return
    }

    this.setDraft(request.message)
    if (context !== undefined) {
      this.attach({
        id: 'prompt-context',
        label: `From ${who}`,
        description: 'Page context',
        context,
      })
    }
    this.focus()
  }

  #titleOf(definitionId: string): string {
    if (definitionId === HOST_SCOPE) return 'the shell'
    const entry = listEntries(this.#runtime.registry).find(item => item.id === definitionId)
    return entry?.title ?? definitionId
  }
}
