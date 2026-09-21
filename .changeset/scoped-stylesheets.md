---
'@company/mfe-rspack': minor
'@company/mfe-react': minor
'@company/create-mfe': patch
---

Each container now ships its own generated stylesheet: `pluginMfe()` writes `.mfe/styles.css` (Tailwind's theme/utilities layers, the design system's `scoped.css`, and `@source` for the container's own `src`), compiles it with `@tailwindcss/postcss` unless the container's own PostCSS config already names it, and imports it from every generated federation entry.

Scoping runs as a PostCSS step, `@tecton/react/postcss/scope`, after Tailwind: it adds `[data-mfe-scope="<id>"]` per exported definition and a `[data-mfe-scope]` lower boundary, and renames the container's own `@keyframes`.

- `withStyleRoot(authored, StyleRoot)` and a generated `.mfe/entries/style-root.tsx`: `AppMount`/`WidgetMount` render it inside the scope root, so a dialog or popover opens from the container's own copy of the design system.
- `pluginMfe()` reads `@tecton/react/federation/shared` for the container's sharing policy; `strictVersion` follows `singleton`.

Two limits: `@property` and `@font-face` register a name page-wide, so two containers defining the same one get whichever the browser parsed last; `@scope` needs Chrome/Edge 118, Safari 17.4 or Firefox 146, with no fallback.
