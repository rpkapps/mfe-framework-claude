export { ChatClient } from './chat-client.ts'
export {
  fetchServerSentEvents,
  type ChatConnection,
  type FetchConnectionOptions,
} from './connection.ts'
export {
  DISCOVER_TOOLS,
  withToolDiscovery,
  type DiscoveredTool,
  type ToolDiscoveryOptions,
} from './discovery.ts'
/** One entry of AG-UI `context`: what `agentContext` and a turn's own context are made of. */
export type { Context as ChatContext } from '@ag-ui/core'
export type {
  ApprovalQuestion,
  ChatClientOptions,
  ChatClientState,
  ChatInterrupt,
  ChatSnapshot,
  ChatTool,
  GenericInterrupt,
  MessagePart,
  SendMessageOptions,
  TextPart,
  ThinkingPart,
  ToolApprovalInterrupt,
  ToolCallPart,
  ToolCallState,
  ToolExecutionContext,
  ToolListContext,
  ToolResultPart,
  ToolResultState,
  UIMessage,
} from './types.ts'
