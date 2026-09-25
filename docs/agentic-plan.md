# Plan: an agentic framework

**Status:** in progress. Steps 0, 4, 1, 2, 3, 6 and 7 and features A to D have landed (§39–§48), and step 5 in part; the AG-UI spike has run (`tools/agent-spike`), and E has begun with the chat client package, `@company/mfe-chat` (§49); the rest is proposed. Each step that lands gets its own entry in `decisions.md`. Nothing is deployed, so none of the steps carries a compatibility path.

## Goal

An agent can do everything a user can do in the shell, through the same paths the user takes, and the chat is part of the page: it knows what the user is looking at, and it can show real UI in its answers.

## The rule

**Apps take URLs, Widgets take props, actions do things.**

The agent sees one list of tools, built by the host from those three sources. Nobody wraps a route or a Widget in an action to make it reachable.

| Kind          | What it is                            | How the agent reaches it                                                   |
| ------------- | ------------------------------------- | -------------------------------------------------------------------------- |
| App route     | where the user is                     | a navigate tool the host generates from each App's published routes        |
| Widget        | UI with props                         | a render tool the host generates from the registry's published contracts   |
| Action        | something an App, Widget or host does | the action itself                                                          |
| Agent context | what the user is looking at           | pushed with each turn; reading the full records behind it is a read action |

Not an action: UI state that is only the component's own (a dropdown opening, a hover).

The agent does not click through the UI. Driving the page through its accessibility tree remains a fallback for what has no action yet, not a design.

## Who owns what

- **This framework** — the contract, and no model: action schemas and policy, the published route and Widget schemas, the agent-context store, the audit field that says who acted, and one host API that lists and runs all of it.
- **The shell, or a package of its own** — the chat surface and the client side of the agent loop. It has to be at host level, because it needs every mount's actions and the navigator, and a Widget has no global effects (`no-widget-global-effects`).
- **Tecton** — the chat components (`Message`, `Bubble`, `MessageScroller`, `Marker`, `Attachment`, `Questionnaire` exist) and the built-in chat renderers for a table, a chart and a summary.
- **A backend agent service** — the loop (likely TanStack AI's `chat()` with a provider adapter), the model calls, keys, domain tools, permissions and audit storage. Never in the browser bundle.
- **Apps and Widgets** — no agent library. They use `useAction` / `injectAction` and `useAgentContext` / `injectAgentContext` from their adapter, and a Widget shown in the chat is an ordinary Widget. Lint enforces it (step 7).

Page tools versus domain tools: actions live in mounted pages, so they run in the browser and only while their mount exists. The model loop runs on a backend and sends each call of a page tool back to the page to execute (AG-UI supports tools the client defines and runs). Work that has to run with no page open (scheduled jobs, triage) needs tools on the owning team's backend, exposed over MCP. The shell's chat merges both.

The backend is replaceable, including by a .NET one (Microsoft's Agent Framework hosts AG-UI in ASP.NET Core). What keeps it so: the shell speaks only AG-UI to the backend and works without any library's extras on the wire (TanStack AI's `metadata.tanstack`, for one); chat history is stored as AG-UI messages, not in a library's format; page tools cross as JSON Schema, which the build already publishes; and the approval policy and audit rules are data, not code in one SDK. A backend swap then touches the backend and at most the shell's chat module, never a container.

## Refactors first

Each is its own commit, with the framework's tests green and no change in behaviour except where stated.

### 0. Rename commands to actions (done, §39)

- `CommandRegistration` → `ActionRegistration`, `CommandEntry` → `ActionEntry`, `CommandRegistry` → `ActionRegistry`, `useCommand` → `useAction`, `runtime.commands` → `runtime.actions`, across core, runtime, the adapters, the shell and the examples.
- The placement `'command-palette'` → `'palette'`; the error codes `command/*` → `action/*`.
- No alias: nothing is deployed.
- Decision entry: why "action" (a typed operation any caller uses; "command" reads as a palette entry, and in CQRS as a write only), and the overlap with React 19 Actions and Tecton's `ActionBar` (the docs say "MFE action").

### 1. Split execution into a pipeline (done, §40)

`packages/mfe-runtime/src/actions/action-registry.ts` (about 700 lines) mixes shortcut matching and entry bookkeeping with execution.

- Move execution into its own module (`action-executor.ts`); shortcut matching and entries stay in the registry.
- `execute(id)` becomes `execute(id, { caller })`, where `caller` is `'palette' | 'shortcut' | 'ui' | 'agent'`; the `executed` result carries a `value`. `input` joins the call with `inputSchema` (A), so no unvalidated input channel ever exists.
- `#run` becomes ordered steps: decide (`canExecute`) → validate the input → approval (the action's declaration, then the host's policy, see A) → serialize writes → execute → audit. Steps 2–4 and 6 are empty until the action fields below exist.

### 2. Share the build's schema extraction (done, §41)

`packages/mfe-build/src/discovery/widget-contract.ts` reads Zod syntax into JSON Schema for Widgets only (`readInputSchema` titles its output `${id} inputs`). Move the reader into a neutral module so action input schemas, and later route and search schemas, use the same code, and rename the host readers to match (`describeWidgetInputs` → `describeInputs`, `describeWidgetEvents` → `describeOutputs`, `PublishedWidgetContract` → `PublishedContract`). Covered by the existing extraction tests.

As landed: the renames, and no move. The reader is already neutral (`config/zod-static.ts`); an action's schema is live in the page and converted at run time, so the build never reads one, and D calls `readStaticSchema` directly.

In the same step, the Widget contract takes the names actions use: `inputs` becomes `inputSchema`, and `events` becomes `outputSchema`, one object schema with a property per output, whose value is that output's payload schema. That is the shape the registry already publishes (§16's amendment), so the authored and the published contract become the same thing. The rename covers the contract field, the published registry field, the build's reader and the Angular adapter's check that every property is one of the component's `output()`s. The values keep their names: `render` still receives `inputs`, and `emit(name, payload)` validates against the property of that name; `emit` and the `onX` props stay, as Angular keeps "emit" and event binding for its outputs. `DynamicWidget`'s `onEvent(name, payload)` becomes `onOutput`, so no "event" is left in the vocabulary. The readers of a Widget's `outputSchema` (`describeOutputs`, the Angular check) ignore whether a property is required: every output may never be emitted. §16 and §28 get an amendment.

### 3. Extend entry equality with the new fields (done, §42)

`actionEntryEqual` (`packages/mfe-core/src/records.ts`) compares only what the palette displays. Once entries carry a description, an input schema, an effect and more placements, it must compare them, or a changed description never reaches the agent's tool list. Lands in the commit that adds the fields.

### 4. Separate shortcuts from placements (done, §39)

The shell used `placements: []` (a `KEYS_ONLY` constant, now gone from `apps/shell/src/shell/shell-actions.ts`) to mean "keys only". Once `'agent'` is a placement, an empty list would also hide those actions from the agent without anyone noticing. Document that a shortcut fires whatever the placements are, and give those shell actions an explicit placement list.

### 5. Remove compatibility code for deployments that never happened (optional; §16's went with §41)

For example, §16's amendment still accepts the old event-name list "so a shell is deployed first".

### 6. Clear every mount-scoped store from one place (done, §44)

As landed: `mountScopedStores(runtime)` in `mount/mount-context.ts` is the list, and a test fails for a runtime member with `removeMount` that is not on it. The agent-context store joins it in B.

The action registry, the breadcrumb store and the navigator's blockers each collect records per mount, and the agent-context store will be the fourth. They share `SnapshotSource` and `HOST_SCOPE` already; what is left in each is its own logic, so there is no generic store to extract. Their teardown differs, though: `mount/mount-context.ts` clears actions and blockers on dispose, while breadcrumbs rely on their hook's cleanup. Give each store a `removeMount(token)` and clear them all from one list on dispose, so a disposed mount cannot leave context behind that the agent would act on.

### 7. Keep agent libraries out of containers (done, §45)

As landed: `no-restricted-imports` entries in the author presets and in every zone of the `framework` preset, type imports included, with the model providers' SDKs, LangChain and Mastra added to the list. The shell's `application()` preset leaves them allowed; E confines them to the chat module.

`eslint-plugin-mfe` already rejects a shell that imports `@company/mfe-core` or `@company/mfe-runtime`. Add a rule of the same kind that rejects `@tanstack/ai*`, `ai` and `@ai-sdk/*`, `@copilotkit/*` and `@ag-ui/*` in code that runs inside a mount. A hook there could not reach the shell's chat anyway (every mount has a React root of its own), and keeping them out means changing the agent library never rebuilds a container and adds nothing to the shared federation scope. A team's own backend may use whatever it likes.

## Features

### A. Action fields (done, §42)

As landed: the fields below, and the executor's input, approval and serializing steps; audit waits for C. Beyond the plan: approval and serializing apply to an agent's calls only (a user who runs an action is its approval, and a user's run may itself run another action, which a queue would deadlock); a call that waited is looked at again before it runs; the policy is `actionApprovalPolicy` on `createMfeRuntime`, and the surface that asks is set with `actions.setApprover`, without which a call that needs approval is denied. The entry carries both schemas as JSON Schema, converted by the schema's own `toJSONSchema`. `'agent'` is a default placement for a Widget's actions as for an App's.

On `ActionRegistration`:

- `description` — written for the model; `label` stays the menu text.
- `inputSchema` — a Zod object schema, the same field as a Widget's `inputSchema`; published as JSON Schema through step 2 and validated before `execute` runs. Absent means the action takes none. The action receives the validated value as `input`.
- `outputSchema` — optional schema for the one value a call returns.
- `effect` — `'read' | 'write' | 'destructive'`. Undeclared counts as `'write'`.
- `needsApproval` — `boolean` or `(input) => boolean`, for a call that is allowed but should be confirmed (an amount above a threshold, an external recipient).
- `placements` — `'palette'`, `'agent'`, later `'webmcp'`, possibly `'toolbar'` and `'context-menu'`. The default includes `'agent'`: anything a user can reach from the palette, the agent can reach too.
- `parallelSafe` — writes run one at a time unless this is set.
- `followUp` — whether the agent carries on after the result. Defaults to `true`; an action whose result is for the user rather than the agent sets `false`.

Naming: a field that holds a schema ends in `Schema`, a value does not, and actions and Widgets use the same two fields. `inputSchema` and `outputSchema` are the names TanStack AI, the AI SDK, MCP and WebMCP use for a tool, so an action maps onto a tool definition field for field, and they end the ambiguity in today's code, where `inputs` is the schema on a Widget's contract and the values in its `render`. `inputSchema` is the same on both: one object schema of the named values going in, read by the same build code and published in the same shape. `outputSchema` is one object schema on both, and what it describes follows from the kind: an action's describes the one value a call returns; a Widget's has a property per named output, each emitted any number of times, or never, while it is mounted, and wiring Widgets in sequence is one Widget's outputs feeding the next one's inputs. They are declared in different places (`useAction`, `createWidget`), so the two are never side by side. The one place they meet is the shell's chat, which turns both into tools, and there the rule is: a Widget's `outputSchema` is never a tool's `outputSchema`. The render tool's result is only that the Widget was shown; its outputs reach the agent through the paths in F. The module that builds the tools enforces it, with a test. Reporting progress over time is a Widget's job, not an action's.

Safe default: an agent call to an action whose effect is `'write'` or `'destructive'`, declared or not, is confirmed by the user unless the action says otherwise. An author who marks an action `'read'` removes that friction.

Approval policy: the action declares its risk (`effect`, `needsApproval`), and the host may add a policy on top, consulted by the pipeline's approval step, which answers one of three outcomes for a call: approved (runs), denied (refused, and the agent is told why) or ask the user (the card in E). The organization tightens or relaxes it per action without touching the App. The policy is data, so the backend applies the same one to its domain tools (OPA-style, as the AI SDK's `@ai-sdk/policy-opa` does).

`canExecute` stays what it is, a pure read of UI state and never an authorization boundary; the server authorizes.

The App's own button calls the action through what `useAction` returns, so a click, the palette, a shortcut and the agent share validation, approval and audit, and differ only in the recorded caller.

Actions still live in the page and last as long as their mount; they are not server actions and cannot run headless. The decision entry says so.

Angular Apps are first-class, so every author API in this plan ships for both adapters in the same change: `useAction` and `injectAction`, `useAgentContext` and `injectAgentContext`.

### B. Agent context (done, §46, but for selected text)

As landed: `runtime.agentContext` reads the URL layer when a turn is sent and holds the selections; `useAgentContext`/`injectAgentContext` and `useAgentPrompt`/`injectAgentPrompt` in both adapters. A value is parsed by its schema and limited to 4096 characters of JSON. Selected text with ⌘I is the chat's own input and moves to E.

Modelled on Agent-Native's context layers (`context-awareness` in its docs):

- **URL** — every App's current path and search params go into each turn automatically; the framework already knows each boundary. Filters that can be shared live in the search params, so the agent changes them by navigating.
- **Selection** — `useAgentContext({ description, schema, value })`: a mount publishes a small, typed snapshot of what is selected or focused: stable ids, a short label, a `capturedAt`. `description` tells the model what the value is, as CopilotKit's hook of the same name does. Never whole records, never secrets.
- **Reading the full records** — each App offers a read action that turns those ids into fresh data, so the agent checks the live object before it acts.
- **Prompt handoff** — `agent.prompt({ message, context, submit })` on the host, so a click becomes a chat turn: `message` is visible, `context` is hidden, `submit: false` pre-fills for review.
- **Selected text** — ⌘I sends the page's text selection into the next turn.

### C. Who acted (done, §47)

As landed: `ActionAuditRecord` from the executor's last step, for every run and every outcome, including `invalid` and `unavailable`; `'system'` is a new caller for the host's own code; the chat passes `turn` with each call. The input is redacted by key words and by credential-shaped strings. Records go to telemetry (`run action`) and to the host's `auditAction`.

Every action run records the actor (`user`, `agent`, `system`, and for the agent, on whose behalf), the caller, the chat thread and turn, the outcome (`executed`, `denied`, `failed`, and `declined` by the user) and the input with anything that looks like a credential redacted. It goes through the existing diagnostics and telemetry hub; storing it is the backend's job.

### D. Published routes (done, §48)

As landed: `routes: [{ path, search? }]` on an App's registry entry, paths in one syntax (`:name`, `:name?`, `*`), from TanStack file routes (with `validateSearch`, merged down the tree) and from Angular's routes array (paths only). The navigate tool itself is the shell's, in E.

The build publishes each App's route paths and search-param schemas into the registry, with the reader from step 2, as it publishes Widget contracts (§16). The host generates the navigate tool from them. Capability pages (`settings`, `help`, `releaseNotes`) stay as they are.

### E. The chat host in the shell

- Collects the tools: actions with the `'agent'` placement, the navigate tool, the render-Widget tool. It lists them again before every write, because mounts come and go; a call against a stale list is retried after a fresh one, never run.
- Speaks AG-UI, and only AG-UI, to the backend (see the portability rule in "Who owns what"), through `@company/mfe-chat` (§49): the plain `@ag-ui/client` underneath, with TanStack AI's client API (`ChatClient`, `useChat`, `parts`, the tool-call stages, interrupts) copied on top. It was first expected to be TanStack AI's client itself; the spike below showed that client works against TanStack AI's own backend only.
- A one-day spike comes first. It proves one page action called by a backend agent, executed through the pipeline and its result returned; one approval and one interrupt; that approval happens once, deciding whether TanStack AI's `needsApproval` interrupt or the pipeline's approval step drives the card; and that the shell's chat works against an AG-UI server that is not TanStack AI, ideally a minimal .NET one on Microsoft's Agent Framework host.

  Spike result (`tools/agent-spike`, its README has the findings), against a TanStack AI backend, a spec-only one and Agent Framework's .NET host:
  - A page action called by the agent runs through the pipeline with every backend, and its result returns as the tool message.
  - Approval happens once. The pipeline's step drives the card for a page action, because page tools cross as plain AG-UI tools with no approval flag, so `needsApproval` stays on the backend's own tools. The backend's interrupt drives the same card for a domain tool. One resume payload, `{ approved, toolCall }`, answers both backends.
  - TanStack AI's client runs a page tool only when it arrives as TanStack's own interrupt. It leaves a spec backend's pending call unrun, never sends AG-UI `context`, and can answer another backend's interrupt only through an unsafe escape hatch.
  - Decided (§49): the chat runs on the plain `@ag-ui/client`, in a package of its own, `@company/mfe-chat`, with TanStack AI's client API copied. TanStack AI stays a backend option. The AG-UI client works against all three backends.
  - Agent Framework 1.22-preview sends no approval interrupt for a domain tool while the page declares tools. Until that is fixed, .NET domain tools cannot ask for approval in our design.

- Page tools: the backend declares them from the tool list above; a call comes back to the page, runs through the action pipeline, and its return value goes back as the tool result. Tools the page declares come from the browser: the backend lets the model call them, but never trusts them for work on the server.
- Lazy tool discovery: with many Apps publishing actions, the model is given the tools relevant to the task, not the whole list (TanStack AI has this built in).
- Approval, two paths, one card. For a page action, the pipeline's approval step renders a card in the chat and waits for the user's answer before `execute` runs; decline returns a declined result to the agent. For a backend (domain) tool, the backend stops the run with an AG-UI interrupt carrying that call's id; the same card resumes it or declines it.
- Every tool call renders in three stages: its inputs streaming in, running, complete with its result. A tool with no renderer of its own gets one generic card with its label and stage.
- Renders answers with the Tecton conversation components.
- Later: suggested prompts, before the first message and after each answer, which a mounted App can contribute to.
- Replaces the two identical `ai-agent-panel` copies (`examples/operations`, `examples/insights`); the insights `agent-panel` Widget either goes or becomes something the chat renders.

### F. UI in the chat

- A tool result renders as a component only when the tool said it would. Never inferred from the shape of the data, and never HTML or script from a result.
- **Widgets** — the agent calls the render tool with `{ widgetId, inputs }`; the chat shows a skeleton while the inputs stream in, then mounts `<DynamicWidget>` inside a `Message`. The provider validates the inputs, as it always does. The render tool's `followUp` is `false`: showing the Widget ends the turn.
- **Asking the user** — an `ask_user` tool renders a Tecton `Questionnaire`; submitting it answers the call with the user's answers, and the agent carries on with them. Cancelling, or the run being aborted, answers it as declined.
- **Widget outputs back to the agent** — two kinds. Passive: the latest value is readable in later turns. Explicit: a new turn, only from a user's action (an Apply or Submit), never from a timer or an error handler.
- **Built-in renderers** — a table, a chart and a summary card, in Tecton, for data the agent already fetched. The render tool is not a data source and must not be used to invent figures.
- Later: one-off displays with no Widget and no built-in renderer through A2UI (an open spec in which the agent composes UI from a catalogue the client provides), with a Tecton catalogue, rather than a format of our own.

### G. External agents (later)

- **WebMCP** (a draft browser API): expose the page's actions through `document.modelContext`, so a browser agent can use them. An action that needs approval is refused there with a message to confirm in the chat.
- **MCP**: the backend exposes domain tools to outside agents.

## Borrowed from Agent-Native

[BuilderIO/agent-native](https://github.com/BuilderIO/agent-native) (MIT) aims at the same thing, with a server it owns. Taken: one definition with every caller, exposure and approval fields on each operation, approval tied to one exact call (the interrupt's call id, for a backend tool), the context layers, renderers declared by the tool, the passive and explicit ways UI in the chat hands a value back, the audit fields, and the event stream that keeps the model out of the framework.

Not taken: a dependency on it (it owns the server, the database, auth and the agent loop, and is at 0.x with a large dependency tree); agent context stored in SQL on the server (ours is an in-memory store in the shell whose snapshot goes along with each turn); agent-generated HTML in sandboxed frames (it breaks Tecton's rules; the Widget catalogue is the safer form); navigation by a state key the UI polls (we call the navigator).

## Borrowed from CopilotKit

[CopilotKit](https://github.com/CopilotKit/CopilotKit) (MIT) registers tools in the page while the component that owns them is mounted, as our actions are, and created AG-UI. Taken: the three stages of a rendered tool call and a generic card for the rest; the user's answer resolving the call a card belongs to (`useHumanInTheLoop`), for approvals and for `ask_user`; AG-UI interrupts for backend approvals; `description` on agent context; `followUp`; APIs for both React and Angular; suggestions and A2UI, later.

Not taken: its hooks inside Apps and Widgets (every mount has a React root of its own, so a hook there cannot reach a provider in the shell, the wall §35 hit with shortcuts; containers use our `useAction`, and only the shell talks to the agent client); its chat components (Tecton has them); tools per agent id (one agent for now); a dependency on it (its API is partway through a v1 to v2 change, and it carries Copilot Cloud hooks such as a license watermark, disabled today).

## Borrowed from TanStack AI

[TanStack AI](https://github.com/TanStack/ai) (MIT) is a good library for a TypeScript backend's loop, and the model for the chat client's API (§49). Taken: its client's public API, not its code (`ChatClient`, `useChat`, `UIMessage` with `parts`, bound interrupts); AG-UI on the wire; one tool definition with a `.server()` or a `.client()` implementation; tools the page declares with each request; the tool-call states (`input-streaming` → `input-complete` → `approval-requested` → `approval-responded`, then the result); `needsApproval` as a name; lazy tool discovery; WebMCP page tools, later.

Not taken: its client as the shell's, which runs a page tool only when TanStack AI's own backend asks for it and never sends AG-UI `context` (the spike); its extras on the wire (`metadata.tanstack`) as anything the shell depends on; its message format for stored history (AG-UI messages instead); any use inside a container. It is pre-1.0 and moves fast (0.57 to 0.61 in four days during the spike).

## Borrowed from the AI SDK

[The AI SDK](https://github.com/vercel/ai) (Apache-2.0, `ai` and `@ai-sdk/*`) is the fallback if TanStack AI proves too unstable. Taken: approval as a policy with three outcomes (approved, denied, ask the user) instead of a flag on each tool alone, and rules kept as data (`@ai-sdk/policy-opa`).

Not taken as the first choice: it has its own stream protocol rather than AG-UI, and no built-in path for tools the page declares with each request. A model given as a plain string goes through Vercel's AI Gateway by default, so the backend passes a provider's model object.

## Not doing

- A generic store for "each mount contributes, the host collects" (see step 6).
- Moving actions to the server.
- Changing mounting, the adapters, federation or isolation; none of this touches them.
- Wrapping routes or Widgets in actions.

## Open questions

- Where the backend runs and who owns it. The loop is likely TanStack AI's `chat()`; a .NET backend stays possible through the portability rule.
- Is the chat composer a Tecton component, or does upstream shadcn have one to sync first?
- Where the audit trail is stored and for how long.

## Order

0 → 4 → 1 → 2 → 3 with A → 6 → 7 → B → C → D → the AG-UI spike → E → F → G. Steps 0 and 4 touch the same files and can go together; step 7 can land at any point before E.
