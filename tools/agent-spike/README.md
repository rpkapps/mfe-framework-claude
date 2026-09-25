# AG-UI spike

The chat it recommends is now `@company/mfe-chat` (docs/decisions.md §49).

The experiment before step E of `docs/agentic-plan.md`: it picks the library the shell's chat
module is built on. It is throwaway. E replaces it, and nothing imports it.

It checks four things:

1. A page action called by a backend agent runs through the action pipeline, and its result
   reaches the agent.
2. Approval happens once, and it is clear which step drives the card.
3. The chat works against a backend that is not TanStack AI: a .NET one on Microsoft's Agent
   Framework host.
4. Which client library the chat should use.

## Running it

```sh
pnpm --filter @company/agent-spike spike
```

That runs the page, both chat clients, a TanStack AI backend and a spec-only backend, all in
process. The model is scripted, so no provider or key is needed.

To include the Agent Framework backend (needs a .NET 10 SDK):

```sh
cd tools/agent-spike/dotnet
ASPNETCORE_URLS=http://127.0.0.1:5089 dotnet run &
AGENT_SPIKE_DOTNET_URL=http://127.0.0.1:5089/agent pnpm --filter @company/agent-spike spike
```

It is not part of `pnpm test`: CI has no .NET, and a spike should not hold up the suite.

## What is where

| File                              | What it is                                                                                                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/page.ts`                     | The shell's runtime, with the operations App mounted. The App registers two agent actions and a selection. A scripted user answers the pipeline's approval card.                                  |
| `src/page-tools.ts`               | Everything E's chat module needs that no library provides. Actions become AG-UI tools, a call runs through the pipeline, agent context goes out as AG-UI context, and approval answers are built. |
| `src/ag-ui-chat.ts`               | The chat on the plain AG-UI client (`@ag-ui/client`). One user turn takes as many runs as it needs.                                                                                               |
| `src/servers/tanstack-backend.ts` | A backend on TanStack AI's `chat()`. It uses `mergeAgentTools` and owns one domain tool that needs approval.                                                                                      |
| `src/servers/spec-backend.ts`     | A backend that speaks only AG-UI 1.0 as the spec writes it, as Agent Framework's host does.                                                                                                       |
| `dotnet/`                         | The Agent Framework (.NET) backend: Microsoft's AG-UI host on ASP.NET Core, with a scripted `IChatClient`.                                                                                        |
| `src/spike.test.ts`               | The questions, one test each.                                                                                                                                                                     |

Versions tested: `@ag-ui/client` and `@ag-ui/core` 1.0.0, `@tanstack/ai` 0.58.0, `@tanstack/ai-client` 0.33.2, `Microsoft.Agents.AI` 1.22.0 and `Microsoft.Agents.AI.Hosting.AGUI.AspNetCore` 1.22.0-preview. An earlier probe used TanStack AI 0.61.0 with client 0.35.1 and gave the same results.

## Results

|                                              | TanStack AI backend                                            | Spec-only backend         | Agent Framework (.NET)                                                             |
| -------------------------------------------- | -------------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------- |
| **Plain AG-UI client**: page action          | Runs through the pipeline                                      | Runs through the pipeline | Runs through the pipeline                                                          |
| **Plain AG-UI client**: domain tool approval | Interrupt, card, resume (with one ordering fix on the backend) | n/a                       | Interrupt, card, resume, but only when the page declares no tools (see finding 10) |
| **Plain AG-UI client**: page context         | Sent as AG-UI `context`                                        | Sent                      | Sent                                                                               |
| **TanStack AI client**: page action          | Runs, natively                                                 | Left pending, never run   | Left pending, never run (probe)                                                    |
| **TanStack AI client**: page context         | Never sent (`context: []`)                                     | Never sent                | Never sent                                                                         |

**1. Page action to agent.** It works with every backend, through the real pipeline. The call is
validated, the pipeline asks the user, execution runs, and the audit record carries
`actor: agent` with the chat thread and run. The result goes back to the agent as the tool
message. A call to an action whose mount has gone since the tools were sent is answered
`unavailable` and never runs.

**2. Approval happens once.**

- **Page actions:** the pipeline's approval step drives the card. The backend gets page actions as
  plain AG-UI tools, which carry no approval flag, so it never asks as well. The tests assert the
  pipeline asked exactly once.
- **Backend (domain) tools:** the backend's AG-UI interrupt drives the same card, and the pipeline
  is not involved.

TanStack AI's `needsApproval` belongs on the backend's own tools only, never on page tools.

**3. Against a backend that is not TanStack AI.** The plain AG-UI client works against Agent
Framework's host for page actions, and for its approvals within the limit in finding 10.
TanStack AI's client does not run a page tool against either spec backend.

**4. Library.** The recommendation is the plain AG-UI client (`@ag-ui/client`) for the shell's chat
module, rather than TanStack AI's client. The chat module adds what no library gives it:
`page-tools.ts`, plus a small reducer for the three stages of a tool call and a React binding
through `useSyncExternalStore`. TanStack AI stays a good choice for a TypeScript backend's loop.
The AI SDK was not tried. It does not speak AG-UI, so without an adapter it fails the portability
rule.

Why the plain AG-UI client:

- It speaks the spec both ways, so a backend swap stays a backend change.
- It sends AG-UI `context`, the page's agent context.
- It keeps history as AG-UI messages, the format the plan stores.
- TanStack AI's client needs private paths against any backend that is not TanStack AI (findings
  1 to 3).

What it costs: it brings `rxjs`, `zod` 3, `uuid` and `fast-json-patch` into the shell. They never
enter a container.

## Findings

About TanStack AI's client:

1. **It runs a page tool only when the tool arrives as its own interrupt.** That interrupt carries
   `metadata.kind: 'client_tool'`. A spec backend ends the run with `success` and the call
   pending, and the client leaves the call at `input-complete`. It can be driven by hand
   (`addToolResult`), outside the client's own flow.
2. **It never sends AG-UI `context`.** The request builder writes `context: []`, so the page's
   agent context could travel only in `forwardedProps`, which is not the spec's place for it.
3. **It does not recognise a spec approval interrupt from another backend.** Agent Framework's
   `reason: 'tool_call'` interrupt, which has no TanStack metadata, is exposed as `kind: 'unbound'`
   with nothing to resolve it. Only `resumeInterruptsUnsafe` can answer it (seen in a probe).

About TanStack AI's backend:

4. **It sends a resumed run's first event before `RUN_STARTED`.** The run that resumes an
   approved tool opens with that tool's `TOOL_CALL_RESULT`, which the spec forbids. The strict
   AG-UI client refuses the run. The spike's backend moves `RUN_STARTED` first, and a test shows
   the raw stream. This should be reported upstream.
5. **A resume must name `parentRunId`**, the interrupted run. The spec allows this, and a client
   middleware adds it.
6. **Answering calls must keep declaring the answered tools.** Its stateless resume rebuilds the
   interrupt batch from the tools the run declares, so a run answering calls must keep declaring
   those tools, even when their mount has gone. Agent Framework also recognises a page tool's
   result by the declared names.
7. **It churns fast.** Versions 0.57 to 0.61 shipped within four days. The first release on AG-UI
   1.0, 0.59, was still under the repository's one-day release-age limit during the spike, and
   0.58 pins a pre-1.0 AG-UI canary. E should pin 0.59 or later.

About Agent Framework's AG-UI host (1.22.0-preview):

8. **It writes `null` for every unset field**, and AG-UI's TypeScript client 1.0 rejects each such
   event. The backend sets `JsonIgnoreCondition.WhenWritingNull`.
9. **It honours only approvals it recorded when it asked** (`ApprovalResponseBindingChatClient`),
   which is right. Resuming therefore needs three things on the backend:
   - a session store, partitioned by the signed-in user in production;
   - a chat history provider that stores nothing, because the AG-UI client sends the whole
     conversation and a stored copy duplicates the approval request;
   - a resume payload of `{ approved, toolCall: { callId, name, arguments } }`. The host rebinds
     `toolCall` to the call it recorded, so an edited argument cannot slip through.

   TanStack AI reads the same payload (it takes `approved` from it), so `approvalResume` answers
   both backends.

10. **It raises no interrupt for a domain tool when the page declares tools.** On a run where the
    page declares tools, which is every run in our design, it does not interrupt for a domain tool
    that needs approval. It ends with `success` and the call pending, as if the call were the
    page's. The approval flow works only when the page declares no tools, which a test shows. This
    blocks .NET domain-tool approvals until it is fixed upstream. A .NET backend could raise its
    own `InterruptRequestContent`, which the host always sends as an interrupt; that was not tried.

About both:

11. **Tool names have a stricter format than action ids.** Model APIs accept only
    `^[a-zA-Z0-9_-]{1,64}$`, so an action id cannot be a tool name as it stands:
    `operations:acknowledge-alert` goes out as `operations__acknowledge-alert`. The name is looked
    up again when a call comes back, never parsed.
