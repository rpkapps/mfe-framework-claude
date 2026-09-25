# @company/agent-dev

A stand-in for the agent backend, for development only. Which backend a deployment runs, and who
owns it, is not decided yet (docs/agentic-plan.md, open questions). The shell speaks nothing but
AG-UI to it, so whatever it becomes, TanStack AI's `chat()` or Microsoft's Agent Framework in .NET,
replaces this without touching the shell (docs/decisions.md §49).

`pnpm dev` starts it with the shell, on port 3011 (`MFE_DEV_AGENT_PORT`), and the shell's
development configuration points its chat at `http://localhost:3011/agent`. On its own:

```sh
pnpm --filter @company/agent-dev start
```

## Two models

- **The demo agent** (the default) is a script, not a model: no key, no network. It reads the
  user's last message for a few words and answers with the page's own tools, so every path of the
  chat can be worked on:

  | Say                               | It                                                                      |
  | --------------------------------- | ----------------------------------------------------------------------- |
  | `help`                            | lists what follows                                                      |
  | `go to operations`                | calls `navigate`                                                        |
  | `show a table of your tools`      | calls `show_table` with the tools it was given                          |
  | `chart the tools`                 | calls `show_chart` with the tools per owner                             |
  | `summarise the page`              | calls `show_summary` with the agent context                             |
  | `show the well design widget`     | calls `render_widget` with inputs its schema accepts                    |
  | `ask me something`                | calls `ask_user`                                                        |
  | `shut in W-1`                     | calls its own `shut_in_well`, which asks for approval by an interrupt   |
  | the words of an action, `ack A-7` | calls the page action they match, filling an id-shaped input with `A-7` |

  An action the page has but did not declare (tool discovery) is asked for through
  `discover_tools`, then called.

- **A real model** when `ANTHROPIC_API_KEY` and `AGENT_DEV_MODEL` (the model id) are both set:
  Anthropic's Messages API, streamed and translated to AG-UI, through plain `fetch`. The agent
  context goes into the system prompt, and every tool is the page's, so a run that calls tools ends
  with them pending, as the spec writes it.

Neither stores anything: the conversation is what the shell sends with each run.
