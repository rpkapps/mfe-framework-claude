---
'@company/mfe-agent': minor
---

New package: the shell's connection to the agent (§49): a chat client with TanStack AI's client API on the plain AG-UI client.

- `ChatClient`, `fetchServerSentEvents` and `useChat` (`/react`), with messages as `parts` and approvals as `interrupts`.
- `actionTools`, `approvalsIn` and `agentContextOf` (`/actions`) connect the action registry and agent context.
- The client talks to any AG-UI backend.
- Sends queue: one run is in flight at a time, and a turn runs the page's tools one at a time. Every interrupt the last run ended on that nobody answered is resumed as cancelled by the next run; `clear()` starts a thread with none to resume.
- A throw from `tools`, a tool's `followUp` or the connection's headers function fails the turn (`error`, `status: 'error'`, `onError` once) rather than rejecting `sendMessage`; an `onError` that throws rejects `sendMessage` and leaves `error` as the turn's own. The connection, thread and initial messages are fixed when the client is made; `updateOptions` takes the rest.
- Every call ends with a result, as model APIs require: a pending call to a tool the page does not have is answered with an error (`No tool named "…" is available on this page.`) and the turn runs again, within `maxRunsPerTurn`; a failed turn answers the calls it left open as failed, except one a backend's interrupt holds.
- `reload()` sends the last user message again with the `context` and `forwardedProps` it was sent with.
- `editMessage(id, text, options)` (also on `useChat`) replaces a user message and runs from there, dropping everything after it; it stops a turn in flight and goes through the queue like `reload`. Interrupts of the dropped runs are resumed as cancelled, and an answer owed to them is dropped (now also on `reload`).
- `history` limits what each run sends, never the transcript: by default (`limitHistory`, exported) the last 6 user turns go whole, and older turns send tool results over 2000 characters as a stand-in and leave reasoning out, keeping every call with its result. It takes `{ keepTurns, maxToolResultChars }`, a function over the messages, or `false`.
