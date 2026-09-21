/**
 * The search index. `createFromSource` walks every page of the merged tree, asks each one for the
 * structured data `remark-structure` exported (title, description, one record per heading and one
 * per block of body text) and builds a ZBSearch database from it.
 *
 * The text of a record is plain: `source.config.ts` gives `remark-structure` the serialiser in
 * `structured-text.ts`, so nothing of how a page was written — `**bold**`, a code span's
 * backticks, a JSX tag — reaches a snippet. Heading records keep their ids, so a heading hit still
 * navigates to its anchor.
 *
 * Server-only: it is reached from the `/api/search` route handler, which the build prerenders into
 * a static JSON file. The browser downloads that file once and runs the same query engine locally.
 */
import { createFromSource } from 'fumadocs-core/search/server'

import { source } from './source.ts'

export const searchAPI = createFromSource(source)
