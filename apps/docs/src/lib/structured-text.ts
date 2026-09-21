/**
 * Plain text for the search index.
 *
 * `remark-structure` turns a compiled page into the records search is built from — one per heading
 * and one per block of body text — and it produces the text of a record by serialising the node
 * back to Markdown. That is the right default for a document and the wrong one for a snippet:
 * `**bold**`, a code span's backticks and the odd JSX tag reach the dialog exactly as they were
 * written. This replaces the serialiser with one that walks the node and keeps only what a reader
 * would see, the contents of a code span included — half the terms on these pages only ever appear
 * inside one.
 *
 * Only the text changes. A heading record still carries the `id` `remark-heading` gave it, so
 * pressing Enter on a heading hit still lands on that heading.
 *
 * Build-time only: `source.config.ts` hands this to `remark-structure`, and nothing imports it
 * from the application.
 */

import type { StringifyOptions } from 'fumadocs-core/mdx-plugins'

/**
 * The parts of an mdast node this file reads. `mdast` is not a dependency of the site, so — as in
 * `remark-repo-markdown.ts` — the shape is declared here and every field is checked before use.
 */
interface MdastNode {
  type?: unknown
  value?: unknown
  children?: unknown
}

/**
 * Nodes whose `value` is markup or code rather than prose: raw HTML in the two repository
 * Markdown files, an MDX expression, an `import`, and the frontmatter itself.
 */
const SILENT = new Set([
  'html',
  'mdxFlowExpression',
  'mdxTextExpression',
  'mdxjsEsm',
  'yaml',
  'toml',
])

/** Nodes whose children are words in a sentence; everything else separates its children. */
const PHRASING = new Set([
  'paragraph',
  'heading',
  'strong',
  'emphasis',
  'delete',
  'link',
  'linkReference',
  'tableCell',
  'mdxJsxTextElement',
])

/** Every word of a node, in order, with nothing of how it was written. */
function plainText(node: unknown): string {
  if (typeof node !== 'object' || node === null) return ''
  const { type, value, children } = node as MdastNode
  if (typeof type !== 'string' || SILENT.has(type)) return ''
  // A hard break is a space between two words, not a character of its own.
  if (type === 'break') return ' '
  // `text`, `inlineCode` and a fenced block: their value is already the text a reader sees.
  if (typeof value === 'string') return value
  if (!Array.isArray(children)) return ''
  return children.map(child => plainText(child)).join(PHRASING.has(type) ? '' : ' ')
}

/**
 * A record is one line: a snippet is shown clamped to two lines, and the line breaks of the source
 * are where the author's editor wrapped, not where the sentence ends.
 */
function oneLine(text: string): string {
  return text.replace(/\s+/gu, ' ').trim()
}

export const plainTextStringify: StringifyOptions = {
  /*
   * A component is never itself content: `<Callout>` and `<Diagram>` contribute the text inside
   * them and nothing else. Left to the default, the four components fumadocs knows by name are
   * serialised with their tags, and so is any element with no children at all.
   */
  filterElement: node =>
    node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement' ? 'children-only' : true,
  /*
   * Returning text here short-circuits the Markdown serialiser for the whole record. An empty
   * string falls through to it, which is what should happen for a node that has no text: an
   * image, a rule, a component that renders from its attributes.
   */
  stringify: node => oneLine(plainText(node)),
}
