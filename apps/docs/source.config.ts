/**
 * Global `fumadocs-mdx` options. The collections themselves are declared with the macro API in
 * `src/lib/docs.ts`.
 */
import { defineConfig } from 'fumadocs-mdx/config'

import { remarkRepoMarkdown } from './src/lib/remark-repo-markdown.ts'

export default defineConfig({
  mdxOptions: {
    rehypeCodeOptions: {
      themes: { light: 'github-light', dark: 'github-dark-dimmed' },
      defaultColor: false,
      // The fence's language is otherwise nowhere in the output, and the title bar picks its icon
      // from it. `false` would also cost the `text` fences their box-drawing line height.
      addLanguageClass: true,
      // The icon is emitted as a raw SVG string in an attribute; `language-*` feeds a real
      // component instead, so nothing here reaches `dangerouslySetInnerHTML`.
      icon: false,
    },
    /*
     * `remark-image` resolves every image against `public/` and rewrites it into a bundler import.
     * The diagrams are served from `docs/diagrams/` by the plugin in `src/vite/diagrams.ts`
     * instead, so images stay plain `<img src>` and `remarkRepoMarkdown` maps the
     * repository-relative prefixes onto the URL the site serves.
     */
    remarkImageOptions: false,
    remarkPlugins: plugins => [remarkRepoMarkdown, ...plugins],
  },
})
