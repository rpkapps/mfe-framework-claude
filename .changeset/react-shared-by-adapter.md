---
'@company/mfe-rspack': patch
---

`react` and `react-dom` are shared because the adapter's own policy lists them, in the React scope, rather than because the design system's `@tecton/react/federation/shared` contract happens to. The adapter's decision now wins over that contract for every name it lists, so a contract that dropped React could no longer leave a container without a shared one.
