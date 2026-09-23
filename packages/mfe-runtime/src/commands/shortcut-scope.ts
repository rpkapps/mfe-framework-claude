/**
 * Where a command's shortcut may fire, resolved once from whoever registered it, so the registry
 * asks the scope rather than branching on the owner's kind wherever it reads keys.
 */

import { isWithinBoundary, type DefinitionKind } from '@company/mfe-core'

export type ShortcutScope =
  /** The host page's: live wherever the page is, and no container may take its keys. */
  | { readonly kind: 'reserved' }
  /** A Widget's: never live, because a Widget does not own the page's keys, as it does not own its URL. */
  | { readonly kind: 'never' }
  /** An App's: live while the page is inside its boundary. */
  | { readonly kind: 'boundary'; readonly basePath: string }

export const HOST_PAGE_SCOPE: ShortcutScope = Object.freeze({ kind: 'reserved' })

const WIDGET_SCOPE: ShortcutScope = Object.freeze({ kind: 'never' })

export function mountShortcutScope(kind: DefinitionKind, basePath: string): ShortcutScope {
  return kind === 'app' ? { kind: 'boundary', basePath } : WIDGET_SCOPE
}

/** `pathname` is called only for an App's scope, because reading where the page is builds a location. */
export function isLive(scope: ShortcutScope, pathname: () => string | undefined): boolean {
  switch (scope.kind) {
    case 'reserved':
      return true
    case 'never':
      return false
    case 'boundary': {
      const current = pathname()
      return current !== undefined && isWithinBoundary(scope.basePath, current)
    }
  }
}

/**
 * Whether one key press could find both live with neither outranking the other: two in the host
 * page, or two Apps whose boundaries nest, so the page can be inside both at once. The host page
 * outranks every container, so a container's keys that meet the host page's are refused rather
 * than contested.
 */
export function canCoexist(a: ShortcutScope, b: ShortcutScope): boolean {
  if (a.kind === 'reserved' || b.kind === 'reserved') return a.kind === b.kind
  if (a.kind !== 'boundary' || b.kind !== 'boundary') return false
  return isWithinBoundary(a.basePath, b.basePath) || isWithinBoundary(b.basePath, a.basePath)
}
