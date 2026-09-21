---
'@company/mfe-core': minor
'@company/mfe-host': minor
'@company/mfe-react': minor
'@company/mfe-rspack': minor
'@company/mfe-legacy-angular': minor
'@company/eslint-plugin-mfe': minor
---

First implementation of the micro-frontend framework.

Public author surface: `createApp`, `createWidget`, `lazyWidget`, `mfeRoute`, `AppHost`, the shell-state hooks (`useUser`, `useGroups`, `useTheme`), the service hooks (`useTelemetry`, `useMfeSignal`, `useMfeStorage`, `useBasePath`), `useCommand`, `useBreadcrumbs`, `useStoredState`, and the generated `#mfe/config`, `#mfe/fetch` and `#mfe/meta` modules.

- An App's router factory must pass the supplied `basePath`, `history` and `context` through unchanged, or mounting fails with `app/invalid-base-path` or `app/invalid-router`.
- Only the top-level `mfe` namespace and `queryClient` are reserved in router context; author keys are preserved across framework context updates.
- `MfeErrorCode` is a closed union; adding a code is a deliberate contract change.
- Widget inputs and event payloads must be JSON-serializable.
