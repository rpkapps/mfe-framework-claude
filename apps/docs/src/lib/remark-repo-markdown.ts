/**
 * What the two repository Markdown files (`docs/design.md`, `docs/decisions.md`) need before they
 * can be pages, and nothing else. Both have to keep reading as files on GitHub, so the site adapts
 * to them rather than the other way round.
 *
 * Build-time only: `source.config.ts` hands this to the MDX processor, and nothing imports it from
 * the application.
 */

const PREFIXES = [/^\.\/diagrams\//, /^\.\.\/docs\/diagrams\//, /^docs\/diagrams\//, /^diagrams\//]

/**
 * A diagram is linked the way a file beside it links one — `![alt](./diagrams/<name>.svg)` — and
 * the site serves the same directory at `/diagrams/`.
 */
export function rewriteDiagramUrl(url: string): string {
  for (const prefix of PREFIXES) {
    if (prefix.test(url)) return url.replace(prefix, '/diagrams/')
  }
  return url
}

interface MdastNode {
  type: string
  depth?: number
  url?: string
  children?: MdastNode[]
}

interface MdastRoot extends MdastNode {
  children: MdastNode[]
}

/**
 * The compiler's view of the file: `basename` tells `.md` (a repository file) from `.mdx`, and
 * `data.frontmatter` is what `repo-page.ts` resolved for it. `data` is left `unknown` so a real
 * `VFile` satisfies this without importing vfile's types.
 */
interface CompiledFile {
  basename?: string | undefined
  data?: unknown
}

/** Did `repo-page.ts` take the description out of the body? */
function hasBodyIntro(file: CompiledFile): boolean {
  const data: unknown = file.data
  if (typeof data !== 'object' || data === null || !('frontmatter' in data)) return false
  const frontmatter: unknown = data.frontmatter
  if (typeof frontmatter !== 'object' || frontmatter === null) return false
  return 'bodyIntro' in frontmatter && frontmatter.bodyIntro === true
}

function walk(node: MdastNode): void {
  if ((node.type === 'image' || node.type === 'link') && typeof node.url === 'string') {
    node.url = rewriteDiagramUrl(node.url)
  }
  for (const child of node.children ?? []) walk(child)
}

/**
 * A repository file opens with its own `# Title`, because that is how it reads on GitHub. The site
 * renders the title in the page header, so leaving the heading in the body would print it twice.
 * Applies to `.md` only: a page written for this site is `.mdx` and never writes its own `<h1>`.
 *
 * The paragraph under the heading goes the same way, but only when it is where the description
 * came from (`bodyIntro`). A file that declares a description in frontmatter keeps its opening
 * paragraph, because the header is then showing something else.
 */
function stripPageHeader(tree: MdastRoot, file: CompiledFile): void {
  const first = tree.children[0]
  if (first?.type !== 'heading' || first.depth !== 1) return

  let remove = 1
  if (hasBodyIntro(file) && tree.children[remove]?.type === 'paragraph') {
    remove += 1
    // `decisions.md` rules off its introduction; with the introduction gone the rule would open
    // the page.
    if (tree.children[remove]?.type === 'thematicBreak') remove += 1
  }

  tree.children.splice(0, remove)
}

/** A remark plugin: `mdast` types are not a dependency of this app, so the shape is declared here. */
export function remarkRepoMarkdown() {
  return (tree: MdastRoot, file: CompiledFile) => {
    walk(tree)
    if (file.basename?.endsWith('.md') === true) stripPageHeader(tree, file)
  }
}
