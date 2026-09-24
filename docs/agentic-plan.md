# Plan: an agentic framework

**Status:** proposed, not started. Nothing here is decided yet; each step that lands gets its own entry in `decisions.md`. Nothing is deployed, so none of the steps carries a compatibility path.

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
- **A backend agent service** — the model calls, keys, domain tools, permissions and audit storage. Never in the browser bundle.

Page tools versus domain tools: actions live in mounted pages, so they run in the browser and only while their mount exists. The model loop runs on a backend and sends each call of a page tool back to the page to execute (AG-UI supports tools the client defines and runs). Work that has to run with no page open (scheduled jobs, triage) needs tools on the owning team's backend, exposed over MCP. The shell's chat merges both.

## Refactors first

Each is its own commit, with the framework's tests green and no change in behaviour except where stated.

### 0. Rename commands to actions

- `CommandRegistration` → `ActionRegistration`, `CommandEntry` → `ActionEntry`, `CommandRegistry` → `ActionRegistry`, `useCommand` → `useAction`, `runtime.commands` → `runtime.actions`, across core, runtime, the adapters, the shell and the examples.
- The placement `'command-palette'` → `'palette'`; the error codes `command/*` → `action/*`.
- No alias: nothing is deployed.
- Decision entry: why "action" (a typed operation any caller uses; "command" reads as a palette entry, and in CQRS as a write only), and the overlap with React 19 Actions and Tecton's `ActionBar` (the docs say "MFE action").

### 1. Split execution into a pipeline

`packages/mfe-runtime/src/commands/command-registry.ts` (697 lines) mixes shortcut matching and entry bookkeeping with execution.

- Move execution into its own module (`action-executor.ts`); shortcut matching and entries stay in the registry.
- `execute(id)` becomes `execute(id, { input, caller })`, where `caller` is `'palette' | 'shortcut' | 'ui' | 'agent'`; the `executed` result carries a `value`.
- `#run` becomes ordered steps: decide (`canExecute`) → validate the input → approval → serialize writes → execute → audit. Steps 2–4 and 6 are empty until the action fields below exist.

### 2. Share the build's schema extraction

`packages/mfe-build/src/discovery/widget-contract.ts` reads Zod syntax into JSON Schema for Widgets only (`readInputSchema` titles its output `${id} inputs`). Move the reader into a neutral module so action inputs, and later route and search schemas, use the same code. Covered by the existing extraction tests.

### 3. Extend entry equality with the new fields

`commandEntryEqual` (`packages/mfe-core/src/records.ts:76`) compares only what the palette displays. Once entries carry a description, an input schema, an effect and more placements, it must compare them, or a changed description never reaches the agent's tool list. Lands in the commit that adds the fields.

### 4. Separate shortcuts from placements

The shell uses `placements: []` (`KEYS_ONLY` in `apps/shell/src/shell/shell-commands.ts`) to mean "keys only". Once `'agent'` is a placement, an empty list would also hide those actions from the agent without anyone noticing. Document that a shortcut fires whatever the placements are, and give those shell actions an explicit placement list.

### 5. Remove compatibility code for deployments that never happened (optional)

For example, §16's amendment still accepts the old event-name list "so a shell is deployed first".

### 6. Clear every mount-scoped store from one place

The command registry, the breadcrumb store and the navigator's blockers each collect records per mount, and the agent-context store will be the fourth. They share `SnapshotSource` and `HOST_SCOPE` already; what is left in each is its own logic, so there is no generic store to extract. Their teardown differs, though: `mount/mount-context.ts` clears commands and blockers on dispose, while breadcrumbs rely on their hook's cleanup. Give each store a `removeMount(token)` and clear them all from one list on dispose, so a disposed mount cannot leave context behind that the agent would act on.

## Features

### A. Action fields

On `ActionRegistration`:

- `description` — written for the model; `label` stays the menu text.
- `input` — a Zod schema, published as JSON Schema through step 2; validated before `execute` runs.
- `output` — optional schema for the returned value.
- `effect` — `'read' | 'write' | 'destructive'`. Undeclared counts as `'write'`.
- `needsApproval` — `boolean` or `(input) => boolean`, for a call that is allowed but should be confirmed (an amount above a threshold, an external recipient).
- `placements` — `'palette'`, `'agent'`, later `'webmcp'`, possibly `'toolbar'` and `'context-menu'`. The default includes `'agent'`: anything a user can reach from the palette, the agent can reach too.
- `parallelSafe` — writes run one at a time unless this is set.

Safe default: an agent call to an action whose effect is `'write'` or `'destructive'`, declared or not, is confirmed by the user unless the action says otherwise. An author who marks an action `'read'` removes that friction.

`canExecute` stays what it is, a pure read of UI state and never an authorization boundary; the server authorizes.

The App's own button calls the action through what `useAction` returns, so a click, the palette, a shortcut and the agent share validation, approval and audit, and differ only in the recorded caller.

Actions still live in the page and last as long as their mount; they are not server actions and cannot run headless. The decision entry says so.

### B. Agent context

Modelled on Agent-Native's context layers (`context-awareness` in its docs):

- **URL** — every App's current path and search params go into each turn automatically; the framework already knows each boundary. Filters that can be shared live in the search params, so the agent changes them by navigating.
- **Selection** — `useAgentContext(schema, value)`: a mount publishes a small, typed snapshot of what is selected or focused: stable ids, a short label, a `capturedAt`. Never whole records, never secrets.
- **Reading the full records** — each App offers a read action that turns those ids into fresh data, so the agent checks the live object before it acts.
- **Prompt handoff** — `agent.prompt({ message, context, submit })` on the host, so a click becomes a chat turn: `message` is visible, `context` is hidden, `submit: false` pre-fills for review.
- **Selected text** — ⌘I sends the page's text selection into the next turn.

### C. Who acted

Every action run records the actor (`user`, `agent`, `system`, and for the agent, on whose behalf), the caller, the chat thread and turn, the outcome (`executed`, `denied`, `failed`, and `declined` by the user) and the input with anything that looks like a credential redacted. It goes through the existing diagnostics and telemetry hub; storing it is the backend's job.

### D. Published routes

The build publishes each App's route paths and search-param schemas into the registry, with the reader from step 2, as it publishes Widget contracts (§16). The host generates the navigate tool from them. Capability pages (`settings`, `help`, `releaseNotes`) stay as they are.

### E. The chat host in the shell

- Collects the tools: actions with the `'agent'` placement, the navigate tool, the render-Widget tool. It lists them again before every write, because mounts come and go; a call against a stale list is retried after a fresh one, never run.
- Consumes one event stream from the backend, preferably the AG-UI protocol rather than an invented one: message start and delta, tool start and end, approval requests, done.
- Approval: the loop pauses with the action, its input and a key for that exact call. Approve re-sends the turn with the key; decline sends nothing. The prompt is a Tecton `Questionnaire` or dialog.
- Renders answers with the Tecton conversation components.
- Replaces the two identical `ai-agent-panel` copies (`examples/operations`, `examples/insights`); the insights `agent-panel` Widget either goes or becomes something the chat renders.

### F. UI in the chat

- A tool result renders as a component only when the tool said it would. Never inferred from the shape of the data, and never HTML or script from a result.
- **Widgets** — the agent calls the render tool with `{ widgetId, inputs }`; the chat mounts `<DynamicWidget>` inside a `Message`. The provider validates the inputs, as it always does.
- **Widget events back to the agent** — two kinds. Passive: the latest value is readable in later turns. Explicit: a new turn, only from a user's action (an Apply or Submit), never from a timer or an error handler.
- **Built-in renderers** — a table, a chart and a summary card, in Tecton, for data the agent already fetched. The render tool is not a data source and must not be used to invent figures.

### G. External agents (later)

- **WebMCP** (a draft browser API): expose the page's actions through `document.modelContext`, so a browser agent can use them. An action that needs approval is refused there with a message to confirm in the chat.
- **MCP**: the backend exposes domain tools to outside agents.

## Borrowed from Agent-Native

[BuilderIO/agent-native](https://github.com/BuilderIO/agent-native) (MIT) aims at the same thing, with a server it owns. Taken: one definition with every caller, exposure and approval fields on each operation, the pause-and-resume approval with a key per call, the context layers, renderers declared by the tool, the passive and explicit outputs of UI in the chat, the audit fields, and the event stream that keeps the model out of the framework.

Not taken: a dependency on it (it owns the server, the database, auth and the agent loop, and is at 0.x with a large dependency tree); agent context stored in SQL on the server (ours is an in-memory store in the shell whose snapshot goes along with each turn); agent-generated HTML in sandboxed frames (it breaks Tecton's rules; the Widget catalogue is the safer form); navigation by a state key the UI polls (we call the navigator).

## Not doing

- A generic store for "each mount contributes, the host collects" (see step 6).
- Moving actions to the server.
- Changing mounting, the adapters, federation or isolation; none of this touches them.
- Wrapping routes or Widgets in actions.

## Open questions

- Is `'agent'` a default placement for Widget actions as well as App actions?
- Which backend runs the loop, and which protocol it streams (AG-UI is the proposal).
- Is the chat composer a Tecton component, or does upstream shadcn have one to sync first?
- Where the audit trail is stored and for how long.

## Order

0 → 4 → 1 → 2 → 3 with A → 6 → B → C → D → E → F → G. Steps 0 and 4 touch the same files and can go together.
