# @company/mfe-agent

The shell's connection to the agent. Its chat client talks AG-UI to the agent's backend and offers
the page's actions to the agent as tools. It runs the agent's calls through the action pipeline and shows one list of
approvals: those the pipeline asks for and those the backend asks for.

It is for the host only. A container never imports it, and the lint presets reject it there.
Underneath is the plain AG-UI client (`@ag-ui/client`). It speaks the spec both ways, so any AG-UI
backend will do, TanStack AI's or Agent Framework's (.NET) alike (docs/decisions.md §49).

## Use

```ts
import { ChatClient, fetchServerSentEvents } from '@company/mfe-agent'
import { actionTools, agentContextOf, approvalsIn } from '@company/mfe-agent/actions'

const chat = new ChatClient({
  connection: fetchServerSentEvents('/agent', { headers: () => ({ Authorization: token() }) }),
  tools: () => actionTools(runtime.actions),
  agentContext: () => agentContextOf(runtime.agentContext),
})
runtime.actions.setApprover(approvalsIn(chat.requestApproval))

await chat.sendMessage('Acknowledge alert A-7')
```

In React, `useChat(options)` from `@company/mfe-agent/react` returns the snapshot (`messages`,
`status`, `isLoading`, `error`, `interrupts`) and the methods (`sendMessage`, `reload`, `stop`,
`clear`, `setMessages`, `requestApproval`).

## The API is TanStack AI's

The names and shapes follow [TanStack AI](https://github.com/TanStack/ai)'s client (`@tanstack/ai-client`, `@tanstack/ai-react`), so its documentation reads across. Only the API is copied, not the code. The source comments say which TanStack AI name each piece follows.

| TanStack AI                                                               | Here                                          |
| ------------------------------------------------------------------------- | --------------------------------------------- |
| `new ChatClient(options)`, `useChat(options)`                             | the same                                      |
| `connection: fetchServerSentEvents(url, …)`                               | the same                                      |
| `UIMessage` with `parts` (`text`, `tool-call`, `tool-result`, `thinking`) | the same                                      |
| tool-call states, `awaiting-input` to `complete`                          | the same                                      |
| `interrupts`, each with `resolveInterrupt` and `cancel`                   | the same, `kind` `tool-approval` or `generic` |
| `sendMessage`, `reload`, `stop`, `clear`, `setMessages`                   | the same                                      |
| `status`: `ready`, `submitted`, `streaming`, `error`                      | the same                                      |

Where it differs, it is because our design does:

- **Tools come from the action registry.** `tools` takes a function that is read again before
  every run, because mounts come and go. There is no `toolDefinition().client()`.
- **History is AG-UI messages** (`getHistory()`, `initialMessages`, `setMessages`). `parts` is the
  view of them, and a tool's result sits in the message that called it.
- **One list of approvals.** A page action's approval comes from the pipeline through
  `requestApproval`, with `source: 'page'`. A backend tool's comes from its interrupt, with
  `source: 'backend'`. Both are `tool-approval` interrupts, so one card renders both.
- **`agentContext`** is sent as AG-UI `context`. TanStack AI's `context` is something else: a value
  handed to tools.
- **Not copied:** queued sends, persistence adapters, subagents, structured output and
  `addToolResult`.

## What a turn does

One user turn takes as many runs as it needs:

- **A run ends with the page's tools pending**, or on an interrupt for a call to one of them. The
  client runs those tools through the pipeline, answers each call with a tool message, and runs
  again. An interrupt on a page tool always means "run it": a backend never asks for a page
  tool's approval, since the pipeline asks the user itself. TanStack AI's backend stops a run
  this way; the spec leaves the call pending. The answering run still declares the answered tools, even if their mount has gone,
  because both backends recognise an answer by the declared tools.
- **A run ends on an approval interrupt for the backend's own tool.** The card shows it. The answer resumes the run with
  `{ approved, toolCall }`, which both backends read, and names the interrupted run as
  `parentRunId`.
- **A pending call the page does not own** is the backend's to answer, so the turn ends there.

A tool with `followUp: false` (an action that declares it, or UI the chat shows) ends the turn
once every call the run made is answered by such a tool: its result is for the user, not for the
agent to talk over. The answers still reach the backend, with the next run.

`sendMessage(text, { context })` sends extra AG-UI `context` with that turn's runs only, unseen in
the transcript: what a page attached to a prompt, or the text the user selected.

A message sent while a turn runs waits for it to end, so one run is in flight at a time; a
backend's question still open is abandoned first. The page's tools run one at a time.

Stopping a turn answers the page's open questions as declined, and answers any call that never
ran as stopped. Every interrupt the last run ended on that nobody answered (the user stopped, or
the run carrying the answer failed) is resumed as cancelled by the next run, as the spec requires.
`clear()` starts a new thread with nothing to resume.

## Many tools

`withToolDiscovery(tools, { threshold, eager })` follows TanStack AI's lazy tool discovery. Up to
`threshold` tools (24 by default), every one is declared. Above it, a run declares the `eager`
tools, those discovered earlier in the conversation, and `discover_tools`, whose description names
the rest with a line each. The agent calls it with the names it needs and gets their definitions;
from the next run on they are declared.

```ts
tools: withToolDiscovery(() => [...shellTools, ...actionTools(runtime.actions)], {
  eager: tool => shellToolNames.has(tool.name),
}),
```
