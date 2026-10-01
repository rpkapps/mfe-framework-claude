/**
 * Isomorphic page lookup. `source.ts` is server-only, so the browser finds the compiled body of
 * the page it is rendering through the collections themselves, keyed by the virtual path the
 * loader reported.
 */
import { docs, repoDocs } from './docs.ts'
import { REPO_DOCS_DIR } from './repo-page.ts'

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

const REPO_PREFIX = `${REPO_DOCS_DIR}/`

/**
 * `source.ts` reports a repository file under its folder in the tree (`how-it-works/design.md`),
 * while `repoDocs` keys it by the path inside its own directory (`design.md`).
 */
function repoPath(path: string): string {
  return path.startsWith(REPO_PREFIX) ? path.slice(REPO_PREFIX.length) : path
}

export function getEntry(path: string): PageEntry | undefined {
  return docs.getPage(path) ?? repoDocs.getPage(repoPath(path))
}
