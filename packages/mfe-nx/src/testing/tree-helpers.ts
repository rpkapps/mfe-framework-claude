/** Small assertions shared by the generator tests; not part of the published package. */

import { join } from 'node:path'

import type { ProjectConfiguration, TargetConfiguration, Tree } from '@nx/devkit'

export function readTreeFile(tree: Tree, path: string): string {
  const buffer = tree.read(path)
  if (buffer === null) {
    throw new Error(`Expected ${path} to exist in the generated tree.`)
  }
  return buffer.toString('utf8')
}

/** Every file under `root`, with its contents, for assertions about the whole project. */
export function readTreeFiles(tree: Tree, root: string): ReadonlyMap<string, string> {
  const files = new Map<string, string>()
  const visit = (directory: string): void => {
    for (const child of tree.children(directory)) {
      const path = join(directory, child)
      if (tree.isFile(path)) files.set(path, readTreeFile(tree, path))
      else visit(path)
    }
  }
  visit(root)
  return files
}

export function targetOf(project: ProjectConfiguration, name: string): TargetConfiguration {
  const target = project.targets?.[name]
  if (target === undefined) {
    throw new Error(`Expected project ${project.name ?? project.root} to have a ${name} target.`)
  }
  return target
}

/** `TargetConfiguration` leaves options untyped (`T = any`) until an executor narrows them. */
type TargetOptions = Readonly<Record<string, unknown>>

export function optionsOf(project: ProjectConfiguration, target: string): TargetOptions {
  return (targetOf(project, target).options ?? {}) as TargetOptions
}

export function configurationOf(
  project: ProjectConfiguration,
  target: string,
  configuration: string,
): TargetOptions {
  return (targetOf(project, target).configurations?.[configuration] ?? {}) as TargetOptions
}

interface RunCommandsOptions {
  readonly command?: string
  readonly cwd?: string
}

export function commandOf(project: ProjectConfiguration, target: string): string | undefined {
  return (optionsOf(project, target) as RunCommandsOptions).command
}
