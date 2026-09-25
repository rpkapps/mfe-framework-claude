---
'@company/mfe-agent': minor
---

What the shell's chat needed (§50, §51):

- `sendMessage(text, { context, forwardedProps })` sends a turn's own AG-UI context and forwarded props, unseen in the transcript.
- A tool's `followUp` is `false` or a function of its result: once every call a run made is answered by a tool that does not follow up, the turn ends, and the answers go with the next run.
- A tool's `execute` receives an abort `signal`, aborted when the user stops the turn, so a tool that waits on the user answers at once. `actionTools` passes it to the action pipeline, so a page action's call still queued or running resolves `cancelled` and its own signal aborts.
- `withToolDiscovery(tools, { threshold, eager })` declares the eager tools, the discovered ones and `discover_tools` above a threshold, after TanStack AI's lazy tool discovery.
- A call's state is published when its arguments end and when its run finishes, so a running page tool no longer shows as streaming.
