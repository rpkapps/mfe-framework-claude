---
'@company/mfe-rspack': minor
'@company/mfe-react': minor
'@company/create-mfe': patch
---

Each container now ships its own stylesheet, so the page no longer depends on
the shell having scanned every container's source.

- **A generated stylesheet per container.** `pluginMfe()` writes `.mfe/styles.css`
  — Tailwind's theme and utilities, the design system's `scoped.css`, and an
  `@source` for the container's own `src` plus any `@tecton/blocks` it depends
  on — and compiles it with `@tailwindcss/postcss`, which the plugin adds unless
  the container's own PostCSS config already names it. Deliberately not
  `@import "tailwindcss"`: preflight, the fonts and every theme variable belong
  to whoever owns the document, and a second copy would repaint the shell rather
  than the container. The variables inherit instead, so a tenant customisation
  or a mode flip in the shell reaches a mounted App with nothing wired up. Every
  generated federation entry imports the stylesheet first, so it loads with
  whichever expose a shell asks for.

- **Scoping moved from the emitted asset to a PostCSS step.** It runs after
  Tailwind on each stylesheet, where the `@layer` structure is still intact, and
  wraps each run of rules in an `@scope` of its own, inside the layer and the
  conditions it was written under, with the lower boundary that separates a
  nested App from its parent. Tailwind's `:root, :host` block becomes `:scope`,
  so a container's own defaults land on its scope root and its overlay root
  instead of on the document. `transformScopedCss` is unchanged as the
  string-level API.

- **`withStyleRoot`, and the design system root wired by the build.** A
  container's overlays have to be created by that container's own copy of the
  library — the components a mount renders read their portal target from that
  copy's React context — so the build generates `.mfe/entries/style-root.tsx`
  and the entry exposes `withStyleRoot(authored, StyleRoot)`. `AppMount` and
  `WidgetMount` render it inside the scope root with the mount's body-level
  overlay root, which already carries the container's `data-mfe-scope`. A dialog,
  a popover or a select therefore opens inside the container's scope, styled by
  the container's own stylesheet. An author writes none of it, and a container
  that renders no design system gets none of it.

Two limits come with this, both stated rather than discovered later.
`@property`, `@keyframes` and `@font-face` register a name for the whole page
and cannot be scoped, so two containers defining the same name end up with
whichever the browser parsed last; the names come from Tailwind and from the
shared design system, so the definitions behind them agree in practice, and
renaming them would break the utilities that read them back. And `@scope` itself
needs Chrome/Edge 118, Safari 17.4 or Firefox 146 — the floor the browser
matrix is already generated against, with no fallback and no polyfill.
