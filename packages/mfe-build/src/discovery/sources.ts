/**
 * The container's own sources as one plan reads them. Parsing is most of what a plan costs, and a
 * watching build re-plans before every compile, so each file is read once per plan, parsed at most
 * once, and keeps its syntax tree into the next plan while its text is unchanged.
 */

import { readFileSync } from 'node:fs'

import { parseSourceFile, type ts } from './ts-ast.ts'

export interface ContainerSources {
  /** The file's text, read from disk once per plan. */
  read(file: string): string
  /** The file's syntax tree, parsed only when its text changed since the previous plan. */
  parse(file: string): ts.SourceFile
}

interface SourceEntry {
  readonly text: string
  sourceFile?: ts.SourceFile
}

/**
 * Each call starts a plan. The comparison is by text rather than by modification time, because an
 * edit that keeps a file's size and lands in the same clock tick would otherwise reuse a stale
 * tree; a file the previous plan read but this one does not is dropped with that plan.
 */
export function createSourceCache(): () => ContainerSources {
  let previous = new Map<string, SourceEntry>()

  return () => {
    const earlier = previous
    const current = new Map<string, SourceEntry>()
    previous = current

    const entry = (file: string): SourceEntry => {
      const known = current.get(file)
      if (known !== undefined) return known

      const text = readFileSync(file, 'utf8')
      const before = earlier.get(file)
      const next = before !== undefined && before.text === text ? before : { text }
      current.set(file, next)
      return next
    }

    return {
      read: file => entry(file).text,
      parse: file => {
        const found = entry(file)
        found.sourceFile ??= parseSourceFile(file, found.text)
        return found.sourceFile
      },
    }
  }
}

/** Sources read for one plan alone, for a caller that runs a single step without a planner. */
export function standaloneSources(): ContainerSources {
  return createSourceCache()()
}
