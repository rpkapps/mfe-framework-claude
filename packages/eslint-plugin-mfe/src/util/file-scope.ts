/**
 * File-scope matching for the rules that are only meaningful inside an
 * explicitly configured part of the tree.
 *
 * Ownership is never guessed from a file name: `no-widget-global-effects` only
 * runs where a repository has declared "these files are Widget-owned", and
 * `no-raw-storage` only stands down where a repository has declared "this file
 * is the storage boundary". Both read their globs from rule options, and both
 * go through this matcher.
 *
 * The syntax is the familiar subset: `**` crosses directory separators, `*` and
 * `?` do not, and `{a,b}` is a flat alternation. A pattern that does not start
 * with a slash or with `**` is implicitly prefixed with `**` plus a slash, so
 * `src/storage/**` matches that directory wherever it sits in the workspace.
 */

const cache = new Map<string, RegExp>()

const REGEXP_SPECIALS: ReadonlySet<string> = new Set([
  '.',
  '+',
  '^',
  '$',
  '(',
  ')',
  '|',
  '[',
  ']',
  '\\',
  '{',
  '}',
])

function compile(pattern: string): RegExp {
  const cached = cache.get(pattern)
  if (cached !== undefined) return cached

  const normalized = pattern.replaceAll('\\', '/')
  const anchored =
    normalized.startsWith('/') || normalized.startsWith('**') || /^[A-Za-z]:\//.test(normalized)
      ? normalized
      : `**/${normalized}`

  let source = ''
  for (let index = 0; index < anchored.length; index += 1) {
    const char = anchored[index] ?? ''
    if (char === '*') {
      if (anchored[index + 1] === '*') {
        if (anchored[index + 2] === '/') {
          // `**/` also matches zero directories, so `**/src` matches `src`.
          source += '(?:[^/]*/)*'
          index += 2
        } else {
          source += '.*'
          index += 1
        }
      } else {
        source += '[^/]*'
      }
      continue
    }
    if (char === '?') {
      source += '[^/]'
      continue
    }
    if (char === '{') {
      const close = anchored.indexOf('}', index)
      if (close !== -1) {
        const alternatives = anchored
          .slice(index + 1, close)
          .split(',')
          .map(part => part.replace(/[.*+^${}()|[\]\\?]/g, '\\$&'))
        source += `(?:${alternatives.join('|')})`
        index = close
        continue
      }
    }
    source += REGEXP_SPECIALS.has(char) ? `\\${char}` : char
  }

  const compiled = new RegExp(`^${source}$`)
  cache.set(pattern, compiled)
  return compiled
}

/** Normalises a path so Windows separators and `./` prefixes compare equal. */
export function normalizePath(filename: string): string {
  const slashed = filename.replaceAll('\\', '/')
  return slashed.startsWith('./') ? slashed.slice(2) : slashed
}

/** True when `filename` matches at least one of the glob patterns. */
export function matchesAnyScope(filename: string, patterns: readonly string[]): boolean {
  if (patterns.length === 0) return false
  const normalized = normalizePath(filename)
  return patterns.some(pattern => compile(pattern).test(normalized))
}
