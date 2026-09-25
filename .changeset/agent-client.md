---
'@company/mfe-agent': minor
---

New package: the shell's connection to the agent (§49): a chat client with TanStack AI's client API on the plain AG-UI client.

- `ChatClient`, `fetchServerSentEvents` and `useChat` (`/react`), with messages as `parts` and approvals as `interrupts`.
- `actionTools`, `approvalsIn` and `agentContextOf` (`/actions`) connect the action registry and agent context.
- The client talks to any AG-UI backend.
