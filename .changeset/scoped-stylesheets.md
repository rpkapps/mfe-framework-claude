---
'@company/mfe-rspack': minor
'@company/mfe-react': minor
'@company/create-mfe': patch
---

Each container now ships its own stylesheet, so the page no longer depends on
the shell having scanned every container's source.

- **A generated stylesheet per container.** `pluginMfe()` writes
  `.mfe/styles.css` — Tailwind's theme and utilities layers, the design system's
  `scoped.css`, and `@source` for the container's own `src` plus any
  `@tecton/blocks` it depends on — compiles it with `@tailwindcss/postcss`,
  added unless the container's own PostCSS config names it, and imports it from
  every generated federation entry. Deliberately not `@import "tailwindcss"`:
  preflight, the fonts and the theme variables stay the document owner's and
  inherit into a mounted App.

- **Scoping is a PostCSS step, and the step is the design system's own.**
  `@tecton/react/postcss/scope` runs after Tailwind with the framework's
  selectors — `[data-mfe-scope="<id>"]` per exported definition, and the
  `[data-mfe-scope]` lower boundary that separates a nested App from its
  parent — and renames the keyframes a container defines after those ids. It
  resolves from the container first, so an older Tecton scopes by its own recipe.

- **`withStyleRoot`, and a style root the build generates.** A container's
  overlays have to come from its own copy of the library, whose React context
  they read their portal target from, so the build writes
  `.mfe/entries/style-root.tsx`, the entry exposes
  `withStyleRoot(authored, StyleRoot)`, and `AppMount` and `WidgetMount` render
  it inside the scope root with the mount's overlay root. A dialog or a popover
  therefore opens inside the container's scope; a container that renders no
  design system gets none of it.

- **The design system's sharing policy comes from the package.** `pluginMfe()`
  reads `@tecton/react/federation/shared` for which of its dependencies a page
  may hold two copies of; `strictVersion` follows `singleton`, and the versions
  come from the container's own install.

Two limits: `@property` and `@font-face` register a name for the whole page and
cannot be scoped, so two containers defining the same name get whichever the
browser parsed last; and `@scope` needs Chrome/Edge 118, Safari 17.4 or Firefox
146, with no fallback.
