/**
 * Isomorphic page lookup. `source.ts` is server-only, so the browser finds the compiled body of
 * the page it is rendering through the collections themselves, keyed by the virtual path the
 * loader reported.
 */
import { docs, repoDocs } from './docs.ts'

import type { TOCItemType } from 'fumadocs-core/toc'
import type { MDXContent } from 'mdx/types'

/**
 * What a route needs from a page of either collection. Both are async collections, so the
 * compiled body is code-split: `preload()` in the loader, then `load()` in render.
 */
export interface PageEntry {
  preload: () => Promise<void>
  body: MDXContent
  load: () => Promise<{ toc: TOCItemType[] }>
}

export function getEntry(path: string): PageEntry | undefined {
  return docs.getPage(path) ?? repoDocs.getPage(path)
}
