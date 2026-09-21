---
'@company/mfe-rspack': patch
'@company/create-mfe': patch
'@company/mfe-react': patch
---

Messages and scaffolded files that described something the code does not do.

- A build diagnostic reads `This expectation is declared by the framework identity rules.` instead of `The framework identity rules declares this expectation.`, which was ungrammatical for every plural `declaredBy`.
- The `load/entry-failure` repair no longer forward-references a share-conflict report nothing emits; it names the symptom a duplicated singleton actually produces — a framework hook reporting that it was rendered outside any mount.
- The scaffold stops gitignoring `runtime-config.local.json` and `.env` and stops writing `runtime-config.example.json`: nothing reads any of them. The App starter's README points at `public/runtime-config.json`, which its dev server publishes and its generated `#mfe/config` fetches.
- The App starter augments TanStack's `StaticDataRouteOption` with `MfeStaticData`, so a route marking a capability page is type-checked against the shape the build extracts.
