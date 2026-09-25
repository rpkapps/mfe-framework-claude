---
'@company/mfe-core': minor
'@company/mfe-runtime': minor
'@company/mfe-react': minor
'@company/mfe-angular': minor
---

What the agent knows of the page travels with each turn (§46). `runtime.agentContext` (`AgentContextStore`) reads the URL layer (the page's path and search params, and each mounted App's path inside its boundary) when a turn is sent, holds the selections mounts publish with `useAgentContext` / `injectAgentContext` (a description, a schema and a value of at most 4096 characters of JSON), and hands a click to the chat through `useAgentPrompt` / `injectAgentPrompt` and `setPromptHandler`. Selections and boundaries go with their mount.
