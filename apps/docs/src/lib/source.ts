/**
 * The page tree and page lookup, built from both collections at once.
 *
 * Server-only: import it inside a `createServerFn` handler or a server route handler, so the
 * loader never reaches the browser bundle.
 */
import { loader, type MetaData, type StaticSource } from 'fumadocs-core/source'

import { docs, repoDocs } from './docs.ts'

/** A page of either collection: the site's own MDX, or a Markdown file from the repository. */
export type DocEntry = (typeof docs.docs)[number] | (typeof repoDocs.docs)[number]

/**
 * `fumadocs-mdx` gives one collection one directory, and `docs/design.md` and
 * `docs/decisions.md` live outside `content/docs`. Concatenating the two virtual file lists puts
 * them in the same tree, so `content/docs/meta.json` can order them beside the written pages.
 */
const merged: StaticSource<{ pageData: DocEntry; metaData: MetaData }> = {
  files: [...docs.toFumadocsSource().files, ...repoDocs.toFumadocsSource().files],
}

export const source = loader({ baseUrl: '/docs', source: merged })
