---
'@company/mfe-build': minor
'@company/mfe-rspack': minor
---

A host, the shell that loads the containers, can now have a runtime configuration of its own, declared in its `src/mfe.config.ts` as a container's is. Its `#mfe/config` validates without Zod, so nothing a host reads before its first paint ships Zod; a container's `#mfe/config` is unchanged and still runs the author's schema.

- `pluginMfeHostConfig()` from `@company/mfe-rspack` points `#mfe/config` at the generated module, serves `.mfe/runtime-config.json` in development and ships the declared defaults as `runtime-config.json` in a build. `mfe-generate --host` writes the same files from the command line: `#mfe/config`, `runtime-config.sh`, `.env.example` and the JSON Schema.
- The generated module checks each value against the JSON Schema the build derives from the declaration, with `checkConfigField`, now exported from the browser-safe `env` subpath of both packages. Its `MfeConfig` type is still inferred from the Zod declarations, through an `import type` the bundler erases.
- It fetches with same-origin credentials and the default cache, so a `<link rel="preload" as="fetch" crossorigin>` in the host document answers it, and it reports a 200 that is not JSON, which a single-page fallback serves for a missing file, as `config/missing`.
- `planHostConfig()` in `@company/mfe-build` is the neutral step both use. The static schema reader also records `z.coerce` and the string transforms (`trim`, `toLowerCase`, `toUpperCase`), which JSON Schema cannot express, so the Zod-free check accepts exactly what Zod would. A container's generated output is unchanged.
