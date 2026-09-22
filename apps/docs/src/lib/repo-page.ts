/**
 * Frontmatter for the two repository Markdown files, and the folder they are rendered in.
 *
 * `docs/decisions.md` is rendered unchanged and `docs/design.md` has to stay plain Markdown that
 * renders on GitHub, so neither carries frontmatter. An async collection ships only the
 * frontmatter to the page tree, which would leave both pages nameless; this schema derives the
 * title from the `# ` heading and the description from the paragraph under it.
 *
 * It is a Standard Schema written by hand rather than a Zod object, for two reasons: the macro
 * leaves this module in the browser bundle, and `@standard-schema/spec` is a type-only package
 * that nothing else here depends on. The shape below is the part of that interface `fumadocs-mdx`
 * reads, so a schema is still inferred structurally.
 */

/**
 * The folder of the page tree the two files are mapped into: they render at
 * `/docs/how-it-works/design` and `/docs/how-it-works/decisions`. `source.ts` passes it to
 * `toFumadocsSource({ baseDir })`, which prefixes the virtual file paths the loader derives slugs
 * from, and `content.ts` takes it off again to find the compiled body in the collection.
 */
export const REPO_DOCS_DIR = 'how-it-works'

/**
 * Titles for files whose own `# ` heading is not the name the page tree should show, keyed by file
 * name: `fumadocs-mdx` hands the schema an absolute path. `design.md` opens with `# Design map`,
 * and the folder it renders in already says "How it works".
 */
const TITLES: Record<string, string> = { 'design.md': 'The design map' }

export interface RepoPageData {
  title: string
  description?: string
  /**
   * The description was read out of the body, so the body still opens with it and
   * `remark-repo-markdown.ts` takes that paragraph out. Set only when the file has no frontmatter
   * description of its own.
   */
  bodyIntro?: true
}

/** The subset of `StandardSchemaV1` a collection schema has to satisfy. */
export interface RepoPageSchema {
  readonly '~standard': {
    readonly version: 1
    readonly vendor: string
    readonly types?: { readonly input: unknown; readonly output: RepoPageData } | undefined
    readonly validate: (value: unknown) => {
      readonly value: RepoPageData
      readonly issues?: undefined
    }
  }
}

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n/

function body(source: string): string {
  return source.replace(FRONTMATTER, '')
}

/** The text of the first `# ` heading, with inline code ticks and emphasis markers removed. */
function firstHeading(source: string): string | undefined {
  const match = /^#\s+(.+)$/m.exec(body(source))
  return match?.[1]?.replace(/[`*_]/g, '').trim()
}

/**
 * The whole paragraph under the title, on one line. `remark-repo-markdown.ts` removes that
 * paragraph from the body, so the description has to be all of it and not a first sentence.
 */
function firstParagraph(source: string): string | undefined {
  const after = body(source).split(/^#\s+.+$/m)[1]
  if (after === undefined) return undefined
  const paragraph = after
    .split(/\r?\n\r?\n/)
    .map(block => block.trim())
    .find(block => block.length > 0 && !block.startsWith('#') && !block.startsWith('---'))
  if (paragraph === undefined) return undefined
  return paragraph.replace(/\s+/g, ' ').replace(/[`*_]/g, '')
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? { ...value } : {}
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * `fumadocs-mdx` calls this with the file's path and raw source, then validates the parsed
 * frontmatter against what it returns.
 */
export function repoPageSchema(ctx: { path: string; source: string }): RepoPageSchema {
  return {
    '~standard': {
      version: 1,
      vendor: 'company-docs',
      validate(value: unknown) {
        const data = asRecord(value)
        const path = ctx.path.replaceAll('\\', '/')
        const name = path.slice(path.lastIndexOf('/') + 1)
        const title =
          asString(data['title']) ?? TITLES[name] ?? firstHeading(ctx.source) ?? 'Untitled'
        const declared = asString(data['description'])
        const description = declared ?? firstParagraph(ctx.source)
        if (description === undefined) return { value: { title } }
        if (declared !== undefined) return { value: { title, description } }
        return { value: { title, description, bodyIntro: true } }
      },
    },
  }
}
