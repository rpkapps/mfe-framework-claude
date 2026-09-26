---
'@company/mfe-build': minor
'@company/mfe-rspack': minor
'@company/mfe-react': patch
'@company/mfe-runtime': patch
---

Share what containers actually repeat, and stop sharing what only split them into small chunks.

- `react/jsx-runtime`, `react/compiler-runtime` and `react-dom/client` are shared in the React scope. Each container used to download its own react-dom client (69 KB gzipped) even when the host had provided React. `@company/mfe-react/host` imports `react/compiler-runtime`, so a host that is not built with the React Compiler still provides it.
- `@tecton/react` is no longer shared: each container bundles the components it imports. Measured on every page of the example shell, cold loads mounted 16% sooner at the median (9% on a slow link) with a third of the JS requests, in-app navigation broke even, and each container's `mf-manifest.json` shrank by about 40%. `sonner`, `react-aria-components` and `recharts` stay shared.
- `packageOf` (`@company/mfe-build/federation`) reads a subpath candidate as the package it sits in, and a subpath share states its `version` as a prefix share does.
- The runtime's and the React adapter's development-only diagnostics are now actually stripped from production builds: `DEV` was imported from the shared `@company/mfe-core`, which no minifier can fold across the share boundary.
