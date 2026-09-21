# `@company/docs` — the documentation site

The author-facing documentation for the micro-frontend framework: an index, ten guides, a
glossary, the design map and the decision log. It is a Vite + TanStack Start application,
prerendered to static files, and every piece of its interface is a component from `@tecton/react`,
the design system the shell and the example containers use.

## Running it

From the repository root:

| Command             | What it does                                                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `pnpm docs:dev`     | Dev server on <http://localhost:3020> (3000–3005 and 3010 are the shell, the example containers and the stand-in API). |
| `pnpm docs:build`   | Production build, then prerenders every page into `apps/docs/dist/client`.                                             |
| `pnpm docs:preview` | Serves the build output, which is what a static host sees.                                                             |

Inside `apps/docs`, the same three are `pnpm dev`, `pnpm build`, `pnpm preview`, plus
`pnpm typecheck` and `pnpm lint`. `pnpm generate` writes `src/routeTree.gen.ts`; `pnpm dev` and
`pnpm build` write it themselves, and `pnpm check` at the root runs it before type-checking so
neither `tsc` nor ESLint needs a build first. It is generated output: never edit it, never commit
it.

## Where the content lives

```text
apps/docs/content/docs/
  meta.json          the sidebar: three sections, in order
  index.mdx          /docs            "Start here"
  glossary.mdx       /docs/glossary
  guides/
    meta.json        the ten guides, in order
    shape.mdx        /docs/guides/shape   … and nine more
```

A page is MDX with `title` and `description` frontmatter. Quote both: a title with a colon in it
(`'1. The shape: App or Widget'`) is not valid YAML unquoted.

`content/docs/meta.json` divides the tree with separators, and the sidebar renders one group per
separator:

```json title="apps/docs/content/docs/meta.json"
{
  "root": true,
  "pages": [
    "---Start here---",
    "index",
    "design",
    "---Building an App or Widget---",
    "...guides",
    "---Reference---",
    "glossary",
    "decisions"
  ]
}
```

`...guides` flattens the `guides` folder into the section above it, so the ten guides keep their
`/docs/guides/<name>` URLs while sitting in one sidebar group in the order `guides/meta.json`
gives.

### `design.md` and `decisions.md` are rendered, not copied

`/docs/design` and `/docs/decisions` come straight from `docs/design.md` and `docs/decisions.md` in
the repository. Those files are the single source: `docs/design.md` has to render on GitHub, and
`docs/decisions.md` is the decision log every other document links to. Neither is duplicated here.

A `fumadocs-mdx` collection takes one directory, so `src/lib/docs.ts` declares a second collection
over `../../docs` limited to those two files, and `src/lib/source.ts` concatenates the two virtual
file lists into one page tree. That is why `content/docs/meta.json` can list `design` and
`decisions` beside the pages written here.

Neither file carries frontmatter, so `src/lib/repo-page.ts` derives the title from the `# ` heading
and the description from the paragraph under it.

## Writing MDX here

Three traps, every one of which has already cost a writer time:

- **Inline JSX at the start of a line becomes a block.** MDX reads `<Term>`, `<Kbd>` or any other
  tag that begins a line as block-level JSX, which silently ends the paragraph before it and starts
  a new one after, so the sentence renders in two pieces. Prettier then bakes the split in by
  putting a blank line before the tag. Keep inline JSX mid-line: re-wrap the sentence so the tag is
  never the first thing on a line.
- **A literal `{` in prose fails the build.** MDX reads `{` as the start of an expression and the
  build stops with `Could not parse expression with acorn`. Write `\{`, or put the text in a code
  span. The same applies inside a component's children.
- **A code span does not cover the start of the next line inside a JSX block.** In the children of
  a `<Callout>` — or any other JSX block — a line that begins with `{` is read as an expression and
  one that begins with `<word` as a tag, even when an inline code span opened on an earlier line is
  still open across it. The span is no protection, because the block's children are parsed before
  the span closes, and the build reports the expression or the unclosed tag. Keep such text on one
  line inside the code span, or escape it (`\{`, `\<`).

Three more, less surprising but worth knowing:

- **Frontmatter is YAML.** A `title` or `description` containing `: ` has to be quoted:
  `title: '1. The shape: App or Widget'`.
- **A closing tag must not be indented under a list item.** `</Diagram>` after a bulleted text
  equivalent belongs at column 0 with a blank line before it; indented, it reads as more list
  content and the build reports the tag as unclosed.
- **Prettier reformats the code inside a fence.** A fenced block whose language Prettier knows is
  parsed and printed like any other source file: double quotes become single, semicolons go,
  indentation and line breaks are redone. When a fence has to read exactly as written — output
  quoted verbatim, a deliberate mistake, code in somebody else's style — put
  `{/* prettier-ignore */}` on the line before the opening fence.

## Diagrams

The diagrams are Excalidraw scenes rendered by `tools/diagrams/render.mjs` into
`docs/diagrams/<name>.svg`, committed with the scene embedded so `docs/design.md` shows them on
GitHub. The site serves that directory at `/diagrams/<name>.svg` — in dev through a middleware and
at build time by copying it into the output (`src/vite/diagrams.ts`). There is no symlink: a
symlink is not portable to Windows.

In `docs/design.md`, a diagram is plain Markdown, because that file also has to render on GitHub:

```md title="docs/design.md"
![One sentence describing the picture](./diagrams/system-at-rest.svg)

**In words.** The text equivalent, complete enough that a reader with images off learns the same
thing.
```

The `./diagrams/` prefix is rewritten to `/diagrams/` by `src/lib/remark-repo-assets.ts` when the
site compiles the file.

In an MDX page, the same diagram is the `Diagram` component:

```mdx title="apps/docs/content/docs/guides/shape.mdx"
<Diagram
  src="/diagrams/app-vs-widget.svg"
  alt="One sentence describing the picture, for a reader who cannot see it."
  caption="Apps take URLs. Widgets take props."
>
The text equivalent, as Markdown. Paragraphs and lists both render as prose.

- An App owns a stretch of the URL and routes everything below it.
- A Widget owns no URL: it takes props and renders inside somebody else's page.

</Diagram>
```

`Diagram` expects:

- `src` — an absolute URL under `/diagrams/`; the file is `docs/diagrams/<name>.svg`.
- `alt` — one sentence, for a reader who cannot see the picture.
- `caption` — optional, shown under the figure.
- `children` — mandatory. The text equivalent, in Markdown. It renders below the figure inside a
  disclosure labelled "Read this diagram as text".

The SVGs are exported light-on-transparent so GitHub can show them. The dark theme inverts them in
CSS (`invert(1) hue-rotate(180deg)`, the way Excalidraw's own dark export works, so blue stays blue
instead of turning orange) and puts a rounded surface behind them. Nothing about a diagram is
theme-specific on disk.

## The other MDX components

`src/components/mdx.tsx` provides, on top of the plain Markdown elements:

| Component                                   | For                                                      |
| ------------------------------------------- | -------------------------------------------------------- |
| `<Callout type="info \| warning \| error">` | A note that stays on the page. Renders a Tecton `Alert`. |
| `<Steps>` / `<Step>`                        | A numbered procedure.                                    |
| `<Tabs items={[…]}>` / `<Tab value="…">`    | Alternatives side by side. Renders Tecton `Tabs`.        |
| `<Diagram>`                                 | Above.                                                   |
| `<Term>`                                    | The first use of a term on a page: renders a `<dfn>`.    |
| `<Kbd>`                                     | A key cap.                                               |

Headings get anchors, links go through the router, and a fenced code block gets a copy button plus,
when the fence carries `title="path"`, a title bar with an icon for the language:

````mdx
```ts title="src/mfe.ts"
export default createApp({ … })
```
````

## Search

Search covers every page title, description, heading and block of body text, and it is entirely
static.

1. `src/lib/search-server.ts` builds the index with `createFromSource` from `fumadocs-core`, which
   reads the structured data each compiled page exports. `remark-structure` writes that data back
   out as Markdown by default, so `source.config.ts` hands it the serialiser in
   `src/lib/structured-text.ts` instead: a record holds the text a reader sees — no `**`, no
   backticks, no tags — and a heading record still carries the id its anchor needs.
2. `src/routes/api/search.ts` is a route with a server handler and no component, so it is dropped
   from the client route tree and neither the index nor the content reaches the browser bundle.
3. `vite.config.ts` lists `/api/search` among the prerendered pages. The response is JSON rather
   than HTML, so the build writes it to `dist/client/api/search` — one static file.
4. `src/components/search-dialog.tsx` downloads that file once, builds the database in the browser
   and answers every keystroke locally. The query is debounced (150 ms).

The dialog opens on <kbd>⌘K</kbd> / <kbd>Ctrl</kbd>+<kbd>K</kbd> and on <kbd>/</kbd>. Results are
grouped by page; under each page heading come its heading and text hits with the matched words
marked. Arrow keys move, Enter navigates — to the heading's anchor when the hit is a heading or a
block of text. With an empty query the dialog lists every page, in sidebar order.

One thing to know when reading a snippet: a code span is indexed as its contents, so a word that
only ever appears as `` `like this` `` is found — and marked — like any other.

## Adding a page

1. Write `apps/docs/content/docs/<name>.mdx` with `title` and `description` frontmatter.
2. Add its name to `content/docs/meta.json` (or `content/docs/guides/meta.json`) where it belongs.
3. `pnpm docs:dev`. The sidebar, the search index and prev/next follow from the tree.
4. Add the path to `PAGES` in `vite.config.ts` if it is not reachable by a link from another page —
   the prerender crawls links, but the list is what guarantees a page is built.

## What it is built from

Vite 8, `@tanstack/react-start` (prerendered), `fumadocs-mdx` and `fumadocs-core` for the content
and the search, Shiki for code, Tailwind 4, `next-themes` for the mode, and `@tecton/react` for
every component: `Sidebar`, `Command`, `Button`, `LinkButton`, `Collapsible`, `Alert`, `Tabs`,
`Sheet`, `DropdownMenu`, `Kbd`, `Separator`.

`@tecton/react` is a `link:` to the checkout beside this repository, which resolves its own peers
from that checkout. `vite.config.ts` therefore deduplicates `react`, `react-dom`,
`react-aria-components`, `next-themes`, `cn` and `lucide-react` onto this package's copies, and
`tsconfig.json` maps the same specifiers for TypeScript. Without both, a second React Aria breaks
every context the design system reads — the router provider, the sidebar, the command palette.
