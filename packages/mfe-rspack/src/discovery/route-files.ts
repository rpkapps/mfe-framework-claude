/** The files of the routes directory the route tree is generated from, for every reader of it. */

import { readdirSync } from 'node:fs'
import { join, sep } from 'node:path'

const ROUTE_EXTENSIONS = ['.ts', '.tsx'] as const

/** `routeTreeOptions`' `routeFileIgnorePattern`: a colocated test is a file, not a URL. */
const TEST_FILE = /\.(test|spec)\.[jt]sx?$/

/** TanStack Router's default `routeFileIgnorePrefix`: a `-` file or directory holds no route. */
const IGNORE_PREFIX = '-'

/** Every route source file, in a stable order; none when there is no routes directory. */
export function routeFiles(routesDirectory: string): readonly string[] {
  let entries: readonly string[]
  try {
    entries = readdirSync(routesDirectory, { recursive: true, encoding: 'utf8' })
  } catch {
    return []
  }

  return entries
    .filter(entry => ROUTE_EXTENSIONS.some(extension => entry.endsWith(extension)))
    .filter(entry => !entry.endsWith('.d.ts') && !TEST_FILE.test(entry))
    .filter(entry => !entry.split(sep).some(part => part.startsWith(IGNORE_PREFIX)))
    .map(entry => join(routesDirectory, entry))
    .sort()
}
