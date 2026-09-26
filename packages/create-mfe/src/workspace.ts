/**
 * Where a new project sits in the pnpm workspace it joins. The generated manifest depends on the
 * framework through `workspace:*` and `catalog:`, and the generated tsconfig extends the
 * workspace's base configuration, so a project only works as a package of that workspace: inside
 * a directory one of its package globs matches.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'

const WORKSPACE_FILE = 'pnpm-workspace.yaml'
const BASE_TSCONFIG = 'tsconfig.base.json'

export interface WorkspacePlacement {
  /** The directory holding `pnpm-workspace.yaml`. */
  readonly root: string
  /** The generated tsconfig's `extends`, relative to the target, with forward slashes. */
  readonly tsconfigBase: string
}

/** The nearest directory at or above `start` that holds a `pnpm-workspace.yaml`. */
function findWorkspaceRoot(start: string): string | undefined {
  let directory = start
  for (;;) {
    if (existsSync(join(directory, WORKSPACE_FILE))) return directory
    const parent = dirname(directory)
    if (parent === directory) return undefined
    directory = parent
  }
}

function unquote(value: string): string {
  const trimmed = value.trim()
  const quote = trimmed[0]
  if ((quote === "'" || quote === '"') && trimmed.endsWith(quote)) return trimmed.slice(1, -1)
  return trimmed
}

/**
 * The `packages` list of a `pnpm-workspace.yaml`. Read by hand rather than with a YAML parser:
 * the list is a block sequence of plain or quoted strings, which is all pnpm documents for it.
 */
export function workspacePackageGlobs(yaml: string): readonly string[] {
  const globs: string[] = []
  let inPackages = false
  for (const line of yaml.split(/\r?\n/)) {
    const content = line.replace(/\s+#.*$/, '')
    if (content.trim() === '' || content.trimStart().startsWith('#')) continue
    if (!/^\s/.test(content)) {
      inPackages = /^packages\s*:\s*$/.test(content)
      continue
    }
    const item = /^\s+-\s+(.+)$/.exec(content)
    if (inPackages && item?.[1] !== undefined) globs.push(unquote(item[1]))
  }
  return globs
}

/** One path segment against one glob segment, where `*` matches any run of characters. */
function segmentMatches(segment: string, pattern: string): boolean {
  const source = pattern
    .split('*')
    .map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]*')
  return new RegExp(`^${source}$`).test(segment)
}

function segmentsMatch(path: readonly string[], pattern: readonly string[]): boolean {
  const [head, ...rest] = pattern
  if (head === undefined) return path.length === 0
  if (head === '**') {
    for (let skip = 0; skip <= path.length; skip++) {
      if (segmentsMatch(path.slice(skip), rest)) return true
    }
    return false
  }
  const [first, ...remaining] = path
  return first !== undefined && segmentMatches(first, head) && segmentsMatch(remaining, rest)
}

/** Whether pnpm treats `path`, relative to the workspace root, as one of the workspace's packages. */
export function matchesWorkspaceGlobs(path: string, globs: readonly string[]): boolean {
  const segments = path.split('/').filter(segment => segment !== '' && segment !== '.')
  if (segments.length === 0) return false

  const matches = (glob: string): boolean =>
    segmentsMatch(
      segments,
      glob.split('/').filter(segment => segment !== '' && segment !== '.'),
    )

  const included = globs.filter(glob => !glob.startsWith('!')).some(matches)
  const excluded = globs.filter(glob => glob.startsWith('!')).some(glob => matches(glob.slice(1)))
  return included && !excluded
}

function toPosix(path: string): string {
  return path.split(sep).join('/')
}

/** Where `target` joins its workspace, or an error saying why it cannot. */
export function placeInWorkspace(target: string): WorkspacePlacement {
  const root = findWorkspaceRoot(target)
  if (root === undefined) {
    throw new Error(
      `${target} is not inside a pnpm workspace: neither it nor any directory above it has a ` +
        `${WORKSPACE_FILE}. A new project depends on the framework through workspace:* and ` +
        'catalog: references, so create it inside the workspace that holds the shell, in a ' +
        'directory its package globs match.',
    )
  }

  const globs = workspacePackageGlobs(readFileSync(join(root, WORKSPACE_FILE), 'utf8'))
  const path = toPosix(relative(root, target))
  if (!matchesWorkspaceGlobs(path, globs)) {
    const where = path === '' ? 'is the root of' : `(${path}) matches no package glob of`
    const listed = globs.length === 0 ? 'none' : globs.join(', ')
    throw new Error(
      `${target} ${where} the pnpm workspace at ${root}, so pnpm would not install the new ` +
        `project there. The globs in its ${WORKSPACE_FILE} are: ${listed}. Choose a directory ` +
        `one of them matches, or add a glob for this one to ${WORKSPACE_FILE}.`,
    )
  }

  const base = join(root, BASE_TSCONFIG)
  if (!existsSync(base)) {
    throw new Error(
      `The pnpm workspace at ${root} has no ${BASE_TSCONFIG}, which the new project's ` +
        `tsconfig.json extends for the compiler options every project in it shares. Add one ` +
        'there, or create the project in the workspace that holds the shell.',
    )
  }

  return { root, tsconfigBase: toPosix(relative(target, base)) }
}
