---
'@company/mfe-core': minor
'@company/mfe-runtime': minor
'@company/mfe-react': minor
'@company/mfe-angular': minor
---

A mount suggests prompts while it lives (§52): `useAgentSuggestions` and `injectAgentSuggestions` offer up to three `AgentSuggestion`s (an `AgentPrompt` with an optional `label`), which the agent-context store keeps per mount (`suggest`, `suggestHost`, `getSuggestions`, `subscribeSuggestions`) and drops with it. A suggestion's `context` is copied when it is offered, as a selection's value is. The shell's chat shows them as chips.
