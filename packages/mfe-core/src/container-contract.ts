/**
 * What a build writes and the runtime reads, so the two packages cannot drift apart by hand: the
 * CSS scope attribute a mount root carries, the share scope every container's page-wide packages
 * live in, and the Module Federation expose path a definition's kind and id imply when a build
 * leaves it unstated.
 */

import type { DefinitionKind } from './definition.ts'

/** The attribute a mount root carries, and the CSS scope value a container's stylesheet targets. */
export const SCOPE_ATTRIBUTE = 'data-mfe-scope'

/** Module Federation's own scope, where the page-wide packages every container shares live. */
export const PAGE_SHARE_SCOPE = 'default'

/** The expose path a build publishes for a definition, absent an explicit override. */
export function defaultExposePath(kind: DefinitionKind, id: string): string {
  return kind === 'app' ? './app' : `./widgets/${id}`
}
