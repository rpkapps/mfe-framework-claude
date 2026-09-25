# The AG-UI spike

The experiment before step E of `docs/agentic-plan.md`, which picked the library the shell's chat
is built on. Its answer is `@company/mfe-agent`: the plain AG-UI client with TanStack AI's client
API copied on top (docs/decisions.md §49). This page keeps what it found.

The spike's code is removed. It lived in `tools/agent-spike`, added in commit `636a9d5` ("Run the
AG-UI spike that picks the shell's chat library"); `git show 636a9d5 -- tools/agent-spike` shows it,
and `git checkout 636a9d5 -- tools/agent-spike` brings it back. It ran the page (the shell's runtime
with the operations App mounted), two chat clients (the plain `@ag-ui/client`, and TanStack AI's)
and three backends: one on TanStack AI's `chat()`, one that speaks only AG-UI 1.0 as the spec
writes it, and Microsoft's Agent Framework AG-UI host on ASP.NET Core (`dotnet/`, run on demand),
all with a scripted model. Each question was a test.

Versions tested: `@ag-ui/client` and `@ag-ui/core` 1.0.0, `@tanstack/ai` 0.58.0,
`@tanstack/ai-client` 0.33.2, `Microsoft.Agents.AI` 1.22.0 and
`Microsoft.Agents.AI.Hosting.AGUI.AspNetCore` 1.22.0-preview. An earlier probe with TanStack AI
0.61.0 and client 0.35.1 gave the same results.

## The questions

1. A page action called by a backend agent runs through the action pipeline, and its result
   reaches the agent.
2. Approval happens once, and it is clear which step drives the card.
3. The chat works against a backend that is not TanStack AI: a .NET one on Agent Framework.
4. Which client library the chat should use.

## Results

|                                              | TanStack AI backend                                            | Spec-only backend         | Agent Framework (.NET)                                                             |
| -------------------------------------------- | -------------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------- |
| **Plain AG-UI client**: page action          | Runs through the pipeline                                      | Runs through the pipeline | Runs through the pipeline                                                          |
| **Plain AG-UI client**: domain tool approval | Interrupt, card, resume (with one ordering fix on the backend) | n/a                       | Interrupt, card, resume, but only when the page declares no tools (see finding 10) |
| **Plain AG-UI client**: page context         | Sent as AG-UI `context`                                        | Sent                      | Sent                                                                               |
| **TanStack AI client**: page action          | Runs, natively                                                 | Left pending, never run   | Left pending, never run (probe)                                                    |
| **TanStack AI client**: page context         | Never sent (`context: []`)                                     | Never sent                | Never sent                                                                         |

1. **Page action to agent.** It works with every backend, through the real pipeline: the call is
   validated, the pipeline asks the user, execution runs, and the audit record carries
   `actor: agent` with the chat thread and run. The result goes back to the agent as the tool
   message. A call to an action whose mount has gone since the tools were sent is answered
   `unavailable` and never runs.
2. **Approval happens once.** For a page action the pipeline's approval step drives the card: the
   backend gets page actions as plain AG-UI tools, which carry no approval flag, so it never asks as
   well. For a backend (domain) tool the backend's AG-UI interrupt drives the same card, and the
   pipeline is not involved. TanStack AI's `needsApproval` belongs on the backend's own tools only.
3. **A backend that is not TanStack AI.** The plain AG-UI client works against Agent Framework's
   host for page actions, and for its approvals within the limit in finding 10. TanStack AI's client
   does not run a page tool against either spec backend.
4. **Library.** The plain AG-UI client, not TanStack AI's: it speaks the spec both ways, so a backend
   swap stays a backend change; it sends AG-UI `context`; it keeps history as AG-UI messages; and
   TanStack AI's client needs private paths against any other backend (findings 1 to 3). It costs
   `rxjs`, `zod` 3, `uuid` and `fast-json-patch` in the shell, never in a container. TanStack AI
   stays a good choice for a TypeScript backend's loop. The AI SDK was not tried: it does not speak
   AG-UI.

## Findings

About TanStack AI's client:

1. **It runs a page tool only when the tool arrives as its own interrupt**, one that carries
   `metadata.kind: 'client_tool'`. A spec backend ends the run with `success` and the call pending,
   and the client leaves the call at `input-complete`. It can be driven by hand (`addToolResult`),
   outside the client's own flow.
2. **It never sends AG-UI `context`.** The request builder writes `context: []`, so the page's agent
   context could travel only in `forwardedProps`, which is not the spec's place for it.
3. **It does not recognise a spec approval interrupt from another backend.** Agent Framework's
   `reason: 'tool_call'` interrupt, which has no TanStack metadata, is exposed as `kind: 'unbound'`
   with nothing to resolve it. Only `resumeInterruptsUnsafe` can answer it (seen in a probe).

About TanStack AI's backend:

4. **It sends a resumed run's first event before `RUN_STARTED`.** The run that resumes an approved
   tool opens with that tool's `TOOL_CALL_RESULT`, which the spec forbids, and the strict AG-UI
   client refuses the run. The spike's backend moved `RUN_STARTED` first. To be reported upstream.
5. **A resume must name `parentRunId`**, the interrupted run. The spec allows this, and a client
   middleware adds it.
6. **Answering calls must keep declaring the answered tools.** Its stateless resume rebuilds the
   interrupt batch from the tools the run declares, so a run answering calls must keep declaring
   them, even when their mount has gone. Agent Framework also recognises a page tool's result by the
   declared names.
7. **It churns fast.** Versions 0.57 to 0.61 shipped within four days. The first release on AG-UI
   1.0 was 0.59; 0.58 pins a pre-1.0 AG-UI canary. A backend on it should pin 0.59 or later.

About Agent Framework's AG-UI host (1.22.0-preview):

8. **It writes `null` for every unset field**, and AG-UI's TypeScript client 1.0 rejects each such
   event. The backend sets `JsonIgnoreCondition.WhenWritingNull`.
9. **It honours only approvals it recorded when it asked** (`ApprovalResponseBindingChatClient`),
   which is right. Resuming therefore needs, on the backend: a session store, partitioned by the
   signed-in user in production; a chat history provider that stores nothing, because the AG-UI
   client sends the whole conversation and a stored copy duplicates the approval request; and a
   resume payload of `{ approved, toolCall: { callId, name, arguments } }`. The host rebinds
   `toolCall` to the call it recorded, so an edited argument cannot slip through. TanStack AI reads
   the same payload (it takes `approved` from it), so one resume answers both backends.
10. **It raises no interrupt for a domain tool when the page declares tools.** On a run where the
    page declares tools, which is every run in our design, it does not interrupt for a domain tool
    that needs approval: it ends with `success` and the call pending, as if the call were the
    page's. The approval flow works only when the page declares no tools. This blocks .NET
    domain-tool approvals until it is fixed upstream. A .NET backend could raise its own
    `InterruptRequestContent`, which the host always sends as an interrupt; that was not tried.

About both:

11. **Tool names have a stricter format than action ids.** Model APIs accept only
    `^[a-zA-Z0-9_-]{1,64}$`, so `operations:acknowledge-alert` goes out as
    `operations__acknowledge-alert`. The name is looked up again when a call comes back, never
    parsed.
