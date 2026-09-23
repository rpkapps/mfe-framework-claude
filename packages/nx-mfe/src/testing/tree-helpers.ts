/** Small assertions shared by the generator tests; not part of the published package. */

import type { ProjectConfiguration, Tree } from '@nx/devkit'

export function readTreeFile(tree: Tree, path: string): string {
  const buffer = tree.read(path)
  if (buffer === null) {
    throw new Error(`Expected ${path} to exist in the generated tree.`)
  }
  return buffer.toString('utf8')
}

interface RunCommandsOptions {
  readonly command?: string
  readonly cwd?: string
}

/** Every target this generator writes is `nx:run-commands`, so its `options.command` is always a
 * string; `TargetConfiguration`'s own `options` is untyped (`T = any`) until an executor narrows
 * it, which is what makes this one cast worth centralizing instead of repeating at each call
 * site. */
export function commandOf(project: ProjectConfiguration, target: string): string | undefined {
  return (project.targets?.[target]?.options as RunCommandsOptions | undefined)?.command
}
