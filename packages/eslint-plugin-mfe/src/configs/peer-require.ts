/**
 * The framework-specific lint plugins (React Hooks, TanStack, angular-eslint) are optional peer
 * dependencies: an Angular project never installs the React tooling and vice versa. Each preset
 * resolves its own peers through `createRequire` at preset-construction time — never at module
 * import time, so importing a subpath never demands a peer nobody asked for — and a missing one
 * throws a message naming exactly what to install, instead of Node's raw "Cannot find module".
 */

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

function isModuleNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'MODULE_NOT_FOUND'
  )
}

/** Every specifier this preset needs that is not already resolvable, in the order given. */
function missingSpecifiers(specifiers: readonly string[]): string[] {
  return specifiers.filter(specifier => {
    try {
      require.resolve(specifier)
      return false
    } catch (error) {
      if (isModuleNotFound(error)) return true
      throw error
    }
  })
}

/**
 * Throws a single, actionable error naming every missing peer at once, rather than failing on the
 * first `require()` and leaving the rest undiscovered until the next run.
 */
export function requirePeers(specifiers: readonly string[], installCommand: string): void {
  const missing = missingSpecifiers(specifiers)
  if (missing.length === 0) return
  const plural = missing.length > 1
  throw new Error(
    `@company/eslint-plugin-mfe: this preset needs ${missing.join(', ')}, which ${
      plural ? 'are optional peer dependencies' : 'is an optional peer dependency'
    } this package does not install for you. Install ${plural ? 'them' : 'it'}: ${installCommand}`,
  )
}

/** Loads a peer already confirmed present by `requirePeers`, so a real load failure surfaces as-is. */
export function loadPeer<T>(specifier: string): T {
  return require(specifier) as T
}
