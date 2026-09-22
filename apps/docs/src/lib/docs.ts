/**
 * The two content collections, declared with the `fumadocs-mdx` macro API.
 *
 * Isomorphic: imported by routes (client and server). The macro rewrites each call into glob
 * imports, so only frontmatter and the lazy MDX body imports reach the browser bundle.
 */
import { defineDocs } from 'fumadocs-mdx/macro'

import { repoPageSchema } from './repo-page.ts'

/** The pages written for the site, under `apps/docs/content/docs`. */
export const docs = defineDocs({
  dir: 'content/docs',
  docs: { async: true },
})

/**
 * Two Markdown files that live in the repository and are rendered, never copied: `docs/design.md`
 * is the canonical design map and `docs/decisions.md` is the decision log. A collection takes one
 * `dir`, so they are a second collection merged into the same page tree by `source.ts`, which
 * maps them into the `how-it-works` folder.
 */
export const repoDocs = defineDocs({
  dir: '../../docs',
  docs: { async: true, files: ['design.md', 'decisions.md'], schema: repoPageSchema },
  meta: { files: [] },
})
