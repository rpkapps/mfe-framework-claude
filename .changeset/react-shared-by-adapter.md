---
'@company/mfe-rspack': patch
---

`react` and `react-dom` are shared because the adapter's own policy lists them, as strict singletons in the React scope, rather than because the design system's `@tecton/react/federation/shared` contract happens to. The adapter's decision now wins over that contract for every name it lists, so a contract that relaxed or dropped React could no longer give a container a second copy.
