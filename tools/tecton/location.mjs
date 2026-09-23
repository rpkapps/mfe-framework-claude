/**
 * Where the Tecton design system is checked out, read from the one place that says so: the
 * `@tecton/react` override in `pnpm-workspace.yaml`. Everything that needs the location asks
 * here, so moving the checkout is that one line and a `pnpm install`.
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))

/** The override line, as `'@tecton/react': link:<path>`; quoted or not, with or without a comment. */
const OVERRIDE = /^\s+['"]?@tecton\/react['"]?\s*:\s*['"]?link:([^'"\s#]+)/m

/** The path as written, relative to the workspace root, such as `../tecton-ui-1/packages/tecton-react`. */
export function tectonLinkPath() {
  const workspace = readFileSync(resolve(repoRoot, 'pnpm-workspace.yaml'), 'utf8')
  const match = OVERRIDE.exec(workspace)
  if (match === null) {
    throw new Error(
      "pnpm-workspace.yaml has no `'@tecton/react': link:<path>` override, so nothing says where the Tecton design system is checked out.",
    )
  }
  return match[1]
}

/** The absolute directory of the `@tecton/react` package, whether or not it exists yet. */
export function tectonPackageDirectory() {
  return resolve(repoRoot, tectonLinkPath())
}

/**
 * The root of the checkout holding the package: the nearest directory above it with a
 * `pnpm-workspace.yaml`, which is where that checkout keeps its own dependencies. The package
 * directory itself when it is not part of a workspace. Resolved through symlinks when it exists,
 * because that is the path a bundler sees.
 */
export function tectonCheckoutDirectory() {
  const written = tectonPackageDirectory()
  const packageDirectory = existsSync(written) ? realpathSync(written) : written
  for (let directory = packageDirectory; ; directory = dirname(directory)) {
    // This workspace's own root is never the design system's, even for a checkout nested in it.
    if (directory === repoRoot || dirname(directory) === directory) return packageDirectory
    if (existsSync(resolve(directory, 'pnpm-workspace.yaml'))) return directory
  }
}
