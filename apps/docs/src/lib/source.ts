/**
 * The page tree and page lookup, built from both collections at once.
 *
 * Server-only: import it inside a `createServerFn` handler or a server route handler, so the
 * loader never reaches the browser bundle.
 */
import { loader, type MetaData, type StaticSource } from 'fumadocs-core/source'

import { docs, repoDocs } from './docs.ts'
import { REPO_DOCS_DIR } from './repo-page.ts'

/** A page of either collection: the site's own MDX, or a Markdown file from the repository. */
export type DocEntry = (typeof docs.docs)[number] | (typeof repoDocs.docs)[number]

/**
 * `fumadocs-mdx` gives one collection one directory, and `docs/design.md` and
 * `docs/decisions.md` live outside `content/docs`. Concatenating the two virtual file lists puts
 * them in the same tree, so a `meta.json` can order them beside the written pages.
 *
 * `baseDir` prefixes the second list's virtual paths with `how-it-works/`, and the loader derives
 * both the slug and the folder from that path: the two files become
 * `/docs/how-it-works/design` and `/docs/how-it-works/decisions`, ordered by
 * `content/docs/how-it-works/meta.json`. The files themselves are untouched.
 */
const merged: StaticSource<{ pageData: DocEntry; metaData: MetaData }> = {
  files: [
    ...docs.toFumadocsSource().files,
    ...repoDocs.toFumadocsSource({ baseDir: REPO_DOCS_DIR }).files,
  ],
}

export const source = loader({ baseUrl: '/docs', source: merged })
