/**
 * The mark every adapter stamps on the definitions it creates, so a host recognises a definition
 * whichever framework built it, and learns which one did without loading anything else.
 */

import type { DefinitionKind } from './definition.ts'

/**
 * A registered symbol rather than a module-local one: a container that evaluated its own copy of
 * an adapter still produces definitions the shell's copy recognises.
 */
export const DEFINITION_BRAND: unique symbol = Symbol.for('@company/mfe.definition')

/** What every adapter's definition has in common; each adapter adds its own fields. */
export interface BrandedDefinition {
  readonly [DEFINITION_BRAND]: true
  readonly kind: DefinitionKind
  readonly id: string
  readonly version?: string
  /**
   * Which adapter created it, as that adapter names itself: any non-empty string, so an adapter
   * nobody here has heard of brands its definitions exactly as the others do. It is for
   * diagnostics and tools; a host mounts every definition through its own `mount`, so nothing
   * branches on it.
   */
  readonly framework: string
}

export function isBrandedDefinition(value: unknown): value is BrandedDefinition {
  if (value === null || typeof value !== 'object') return false

  const candidate = value as Record<PropertyKey, unknown>
  return (
    candidate[DEFINITION_BRAND] === true &&
    (candidate['kind'] === 'app' || candidate['kind'] === 'widget') &&
    typeof candidate['id'] === 'string' &&
    typeof candidate['framework'] === 'string' &&
    candidate['framework'] !== ''
  )
}
