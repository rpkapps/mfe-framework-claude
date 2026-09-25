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

It answers `POST /agent` and the browser's preflight: another path is 404 and another method 405.
A body over 8 MB is 413, and one that is not an AG-UI `RunAgentInput` is 400, before any model is
called.

## Three models

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
  | `show a form`                     | calls `render_a2ui` with a shift handover form, and answers its button  |
  | `shut in W-1`                     | calls its own `shut_in_well`, which asks for approval by an interrupt   |
  | the words of an action, `ack A-7` | calls the page action they match, filling an id-shaped input with `A-7` |

  An action the page has but did not declare (tool discovery) is asked for through
  `discover_tools`, then called.

- **A model behind an OpenAI-compatible server**, such as an open-weight model on your own
  machine or network, when `AGENT_DEV_OPENAI_URL` (the base URL, `/v1` included) and
  `AGENT_DEV_MODEL` (the id the server serves) are set; `AGENT_DEV_API_KEY` if the server wants a
  key. vLLM, SGLang, llama.cpp's `llama-server`, Ollama and LM Studio all serve this API.

  ```sh
  AGENT_DEV_OPENAI_URL=http://192.168.1.20:8000/v1 AGENT_DEV_MODEL=deepseek-v4.1-flash pnpm dev
  ```

  A reasoning model's thinking (`reasoning_content`, `reasoning`, or inline `<think>` tags) shows in
  the chat as "Thinking" and is never sent back. The chat works through tool calls, so the server
  must have tool calling turned on; without it the model writes its calls as text and nothing runs.

- **Anthropic's Messages API** when `ANTHROPIC_API_KEY` and `AGENT_DEV_MODEL` are set.

Either real model is streamed and translated to AG-UI through plain `fetch`, with no SDK: each
adapter reads its API's stream into the same reply (`src/reply.ts`), which keeps the event order
AG-UI's client checks. The agent context goes into the system prompt, and every tool is the page's,
so a run that calls tools ends with them pending, as the spec writes it. The OpenAI-compatible
server wins when both are set. When the chat goes away mid-run, the model's request is cancelled.

Neither stores anything: the conversation is what the shell sends with each run.
