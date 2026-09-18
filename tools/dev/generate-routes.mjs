#!/usr/bin/env node
/**
 * Generates `src/routeTree.gen.ts` for the MFE in the current working directory.
 *
 * The build plugin runs this during dev and build, but it exists as its own
 * command too: editor declarations have to be available right after a clone,
 * without starting the shell or the bundler. It is also the one documented
 * recovery command when generated output is out of date.
 *
 * The generated tree is build output. It is not checked in, and generation runs
 * before typecheck.
 */

import { Generator, getConfig } from '@tanstack/router-generator'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const routesDirectory = join(root, 'src/routes')

if (!existsSync(routesDirectory)) {
  console.error(
    `No routes directory at ${routesDirectory}.\n` +
      'An App owns a route tree; a project without one is a Widget-only container and needs no generation.',
  )
  process.exit(1)
}

const config = getConfig(
  {
    routesDirectory: 'src/routes',
    generatedRouteTree: 'src/routeTree.gen.ts',
    routeFileIgnorePattern: '\\.(test|spec)\\.[jt]sx?$',
    quoteStyle: 'single',
    semicolons: false,
    disableLogging: true,
  },
  root,
)

const generator = new Generator({ config, root })

try {
  await generator.run()
  console.log(`Generated ${config.generatedRouteTree}`)
} catch (error) {
  console.error('Route tree generation failed.')
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
