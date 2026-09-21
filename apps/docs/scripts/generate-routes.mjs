#!/usr/bin/env node
/**
 * Writes `src/routeTree.gen.ts`.
 *
 * `vite dev` and `vite build` generate it themselves through the TanStack Start plugin; this
 * script is what `pnpm generate` (and therefore `pnpm check`) runs, so `tsc` and ESLint have the
 * file without a build first. The output is generated, never edited and never committed.
 */
import { fileURLToPath } from 'node:url'

import { Generator, getConfig } from '@tanstack/router-generator'

const root = fileURLToPath(new URL('..', import.meta.url))

const config = getConfig(
  {
    target: 'react',
    routesDirectory: 'src/routes',
    generatedRouteTree: 'src/routeTree.gen.ts',
    quoteStyle: 'single',
    semicolons: false,
    disableLogging: true,
  },
  root,
)

await new Generator({ config, root }).run()
