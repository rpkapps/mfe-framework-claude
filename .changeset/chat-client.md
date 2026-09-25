---
'@company/mfe-chat': minor
---

New package: the shell's chat client (§49), with TanStack AI's client API on the plain AG-UI client.

- `ChatClient`, `fetchServerSentEvents` and `useChat` (`/react`), with messages as `parts` and approvals as `interrupts`.
- `actionTools`, `approvalsIn` and `agentContextOf` (`/actions`) connect the action registry and agent context.
- The client talks to any AG-UI backend.
