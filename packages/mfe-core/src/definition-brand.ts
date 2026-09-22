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

/** Listed here and nowhere else; a further adapter extends this list. */
const DEFINITION_FRAMEWORKS = ['react', 'angular'] as const

export type DefinitionFramework = (typeof DEFINITION_FRAMEWORKS)[number]

/** What every adapter's definition has in common; each adapter adds its own fields. */
export interface BrandedDefinition {
  readonly [DEFINITION_BRAND]: true
  readonly kind: DefinitionKind
  readonly id: string
  readonly version?: string
  /** Which adapter created it, so a host can tell a definition it renders from one it hosts. */
  readonly framework: DefinitionFramework
}

export function isBrandedDefinition(value: unknown): value is BrandedDefinition {
  if (value === null || typeof value !== 'object') return false

  const candidate = value as Record<PropertyKey, unknown>
  return (
    candidate[DEFINITION_BRAND] === true &&
    (candidate['kind'] === 'app' || candidate['kind'] === 'widget') &&
    typeof candidate['id'] === 'string' &&
    (DEFINITION_FRAMEWORKS as readonly unknown[]).includes(candidate['framework'])
  )
}
