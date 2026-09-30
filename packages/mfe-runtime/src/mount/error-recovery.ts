/** Recovery actions shared by host surfaces; no renderer or federation dependency is needed. */

import type { MfeError } from '@company/mfe-core'

export type DefinitionRecovery = 'retry' | 'reload' | 'correct-inputs' | 'incompatible'

/** A retry cannot repair a fixed registry snapshot or a runtime API the shell does not expose. */
export function definitionRecovery(error: MfeError): DefinitionRecovery {
  const code: string = error.code
  if (code === 'contract/input-mismatch') return 'correct-inputs'
  if (
    code === 'contract/unsupported-major' ||
    code === 'contract/runtime-incompatible' ||
    code === 'contract/incompatible-widget'
  ) {
    return 'incompatible'
  }
  if (code === 'load/reload-required' || code === 'registry/invalid-entry') return 'reload'
  if (isChunkFailure(error)) return 'reload'
  return 'retry'
}

/** Lazy chunks can fail after mounting, where an adapter reports them as a mount failure. */
function isChunkFailure(error: Error): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    if (
      current.name === 'ChunkLoadError' ||
      /Loading (?:CSS )?chunk .+ failed|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
        current.message,
      )
    )
      return true
    current = current.cause
  }
  return false
}

export function definitionRecoveryMessage(recovery: DefinitionRecovery): string {
  switch (recovery) {
    case 'correct-inputs':
      return 'Correct the widget inputs, then retry with the current inputs.'
    case 'incompatible':
      return 'This feature is unavailable with the currently loaded versions. Reload to check for an update.'
    case 'reload':
      return 'Reload the page to load the currently available version. Save any work first.'
    case 'retry':
      return 'This feature could not load or stopped working. Try again.'
  }
}
