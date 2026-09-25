/**
 * The chat's public shapes. They follow TanStack AI's client (`@tanstack/ai-client`,
 * https://github.com/TanStack/ai): `UIMessage` with `parts`, the tool-call and result states,
 * `ChatClientState`, and interrupts answered with `resolveInterrupt`, so its documentation reads
 * across. What is stored is AG-UI's own `Message` list; `UIMessage` is only the view a transcript
 * renders.
 */

import type { Context, Message } from '@ag-ui/core'

import type { ChatConnection } from './connection.ts'

/** TanStack AI's `ChatClientState`: `submitted` until a run's first event, then `streaming`. */
export type ChatClientState = 'ready' | 'submitted' | 'streaming' | 'error'

/** TanStack AI's `ToolCallState`: a tool call from its first event to its result. */
export type ToolCallState =
  | 'awaiting-input'
  | 'input-streaming'
  | 'input-complete'
  | 'approval-requested'
  | 'approval-responded'
  | 'complete'
  | 'error'

export type ToolResultState = 'complete' | 'error'

export interface TextPart {
  readonly type: 'text'
  readonly content: string
}

export interface ThinkingPart {
  readonly type: 'thinking'
  readonly content: string
}

export interface ToolCallPart {
  readonly type: 'tool-call'
  readonly id: string
  readonly name: string
  /** The arguments as JSON, possibly partial while they stream. */
  readonly arguments: string
  /** The arguments parsed, once they are complete. */
  readonly input?: unknown
  readonly state: ToolCallState
  /** Present once the call was sent for the user's approval. */
  readonly approval?: {
    readonly id: string
    readonly needsApproval: true
    /** Undefined until the user answers. */
    readonly approved?: boolean
  }
  /** The result, parsed from JSON when it is JSON. */
  readonly output?: unknown
}

export interface ToolResultPart {
  readonly type: 'tool-result'
  readonly toolCallId: string
  readonly content: string
  readonly state: ToolResultState
  readonly error?: string
}

export type MessagePart = TextPart | ThinkingPart | ToolCallPart | ToolResultPart

/**
 * TanStack AI's `UIMessage`: one message as a transcript renders it. A tool's result sits in the
 * message that called it.
 */
export interface UIMessage {
  readonly id: string
  readonly role: 'system' | 'user' | 'assistant'
  readonly parts: readonly MessagePart[]
}

/** What a tool's `execute` is told about the call. */
export interface ToolExecutionContext {
  readonly toolCallId: string
  readonly threadId: string
  /** The run that made the call, which an audit records as the turn. */
  readonly runId: string
}

/**
 * A tool the page runs: declared to the agent with every run, and executed here when the agent
 * calls it. Its return value, as JSON, is the tool's result.
 */
export interface ChatTool {
  readonly name: string
  readonly description: string
  /** JSON Schema of the input; an object with no properties when absent. */
  readonly inputSchema?: Readonly<Record<string, unknown>>
  execute(input: unknown, context: ToolExecutionContext): unknown
}

/**
 * TanStack AI's bound `tool-approval` interrupt: a tool call waiting on the user. Here it comes
 * from the page's action pipeline as well as from the backend, which TanStack AI has no need for.
 */
export interface ToolApprovalInterrupt {
  readonly kind: 'tool-approval'
  readonly id: string
  /** `page` for an action the pipeline asked about; `backend` for the backend's own tool. */
  readonly source: 'page' | 'backend'
  readonly toolName: string
  readonly toolCallId?: string
  readonly originalArgs: unknown
  /** What the card shows as the action's name and what it does, when the page knows them. */
  readonly label?: string
  readonly description?: string
  readonly message?: string
  resolveInterrupt(approved: boolean): void
  /** Answers as declined, and for a backend's interrupt tells it the question was abandoned. */
  cancel(): void
}

/**
 * TanStack AI's `generic` interrupt: anything else a backend stops a run for, answered with
 * whatever `responseSchema` describes.
 */
export interface GenericInterrupt {
  readonly kind: 'generic'
  readonly id: string
  readonly reason: string
  readonly message?: string
  readonly toolCallId?: string
  readonly responseSchema?: Readonly<Record<string, unknown>>
  resolveInterrupt(payload: unknown): void
  cancel(): void
}

export type ChatInterrupt = ToolApprovalInterrupt | GenericInterrupt

/** What the pipeline's approval step asks, as `requestApproval` takes it. */
export interface ApprovalQuestion {
  readonly toolName: string
  readonly input: unknown
  readonly label?: string
  readonly description?: string
}

export interface ChatClientOptions {
  readonly connection: ChatConnection
  /** Read again before every run: mounts come and go, and their actions with them. */
  readonly tools?: readonly ChatTool[] | (() => readonly ChatTool[])
  /** Sent as AG-UI `context` with every run, read when the run is sent. */
  readonly agentContext?: () => readonly Context[]
  /** Passed to the backend untouched, as AG-UI `forwardedProps`. */
  readonly forwardedProps?: Readonly<Record<string, unknown>>
  readonly threadId?: string
  /** A stored conversation to continue: AG-UI messages, the format history is kept in. */
  readonly initialMessages?: readonly Message[]
  /** A turn that keeps asking for tools is stopped after this many runs. Defaults to 12. */
  readonly maxRunsPerTurn?: number
  /** A turn ended: every run finished and nothing waits on the user. */
  readonly onFinish?: (message: UIMessage | undefined) => void
  readonly onError?: (error: Error) => void
}

/** Everything a view reads, as one immutable value that changes identity on every change. */
export interface ChatSnapshot {
  readonly messages: readonly UIMessage[]
  readonly status: ChatClientState
  /** A turn is under way: a run is in flight, or the page is running the agent's tools. */
  readonly isLoading: boolean
  readonly error: Error | undefined
  readonly interrupts: readonly ChatInterrupt[]
  readonly threadId: string
  readonly runId: string | null
}
