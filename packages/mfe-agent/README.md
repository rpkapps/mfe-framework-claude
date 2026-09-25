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
`status`, `isLoading`, `error`, `interrupts`) and the methods (`sendMessage`, `editMessage`,
`reload`, `stop`, `clear`, `setMessages`, `requestApproval`).

The connection (its URL, `fetch` and headers function), the thread and the initial messages are
fixed when the client is made. `updateOptions`, which `useChat` calls on every render, takes the
rest. The headers function is called before each run.

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
- **Added:** `editMessage(id, text, options)` edits a user message and runs from there, and
  `history` limits what each run sends (see below), because a long session with the page's tools
  needs both.
- **Not copied:** the send queue's API (`queue`, `cancelQueued`, `whenBusy`; a message sent
  here simply waits for the turn before it), persistence adapters, subagents, structured output
  and `addToolResult`.

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
- **A pending call to a tool the page does not have** (a name the model made up, or a tool
  discovery has not declared yet) is answered with an error, as the result
  `No tool named "…" is available on this page.`, and the turn runs again so the model can
  recover, within `maxRunsPerTurn`. A pending call waits on the client, and one left without a
  result would make a model API reject every later request.

A tool with `followUp: false` (an action that declares it, or UI the chat shows) ends the turn
once every call the run made is answered by such a tool: its result is for the user, not for the
agent to talk over. The answers still reach the backend, with the next run.

`sendMessage(text, { context, forwardedProps })` sends extra AG-UI `context`, and forwarded props
merged over the client's, with that turn's runs only, unseen in the transcript: what a page
attached to a prompt, the text the user selected, or a press in UI the chat showed. `reload()`
sends the last user message again with the options it was sent with, since they are part of the
question; a message restored from a stored history has none.

A message sent while a turn runs waits for it to end, so one run is in flight at a time; a
backend's question still open is abandoned first. The page's tools run one at a time. A throw from
`tools`, a tool's `followUp` or the headers function fails the turn, as a failed run does: it sets
`error` and `status: 'error'` and calls `onError` once. A call the failed turn left without a
result (one the run was streaming when it failed, or one it had yet to run) is answered as failed,
so the next turn's request is one a model API accepts; a call a backend's interrupt holds stays the
backend's. `sendMessage` rejects only if `onError` throws, and `error` stays the turn's own.

Stopping a turn answers the page's open questions as declined, and answers any call that never
ran as stopped. Every interrupt the last run ended on that nobody answered (the user stopped, or
the run carrying the answer failed) is resumed as cancelled by the next run, as the spec requires.
`clear()` starts a new thread with nothing to resume.

`editMessage(id, text, { context })` replaces the user message `id` and runs the conversation
again from there. Every message after it is dropped, the agent's included, and `text` is sent as a
new turn (with a new message id), as `sendMessage` sends it: with the options the edit is given,
not those of the message it replaces, since an edit is a new question. Like `reload`, it stops a
turn in flight first and then waits its place in the queue. The dropped runs take their answers with them: a
result that a stopped tool gives late is cut with its call, and an interrupt they ended on is
resumed as cancelled by the edited turn's first run, since the thread is the same. An id that is not
a user message in the history, or an empty text, does nothing.

## What a run sends

AG-UI sends the whole conversation with every run, and a long session with big tool results
(tables, rendered UI, widget outputs) outgrows the model's context. The `history` option shrinks
the copy a run sends; the transcript (`messages`, `getHistory()`) always keeps every message whole.

- **By default** (`limitHistory`), the last 6 user turns are sent whole, the one running included.
  In older turns, a tool result longer than 2000 characters is replaced by a stand-in
  (`[Result omitted from this request: 12,345 characters. Call the tool again if it is needed.]`),
  and reasoning is left out. Nothing else is dropped, so every tool call keeps its result: backends
  and model APIs reject either one alone. `history: { keepTurns, maxToolResultChars }` changes the
  two numbers.
- **A function** takes the messages the run would send and returns those it sends instead. It
  replaces the default, and can call `limitHistory` (exported) to build on it. It must keep calls
  and results together. A throw fails the turn.
- **`false`** (or `keepTurns: Infinity`) sends the whole conversation.

`history` is read before each run, so `updateOptions` changes it. A resume names interrupts, not
messages, so it is unaffected.

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
