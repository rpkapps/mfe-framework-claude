# Registry copies

Everything under this directory is copied verbatim from the `@tecton`
shadcn registry — the same bytes `shadcn add @tecton/<name> --overwrite`
would write, fetched from the registry's published `r/<name>.json` items.

Blocks here: `ai-agent-panel`, `cost-vs-risk-panel`, `fda-card`,
`well-design-card`.

Do not hand-edit these files. To pick up a design-system change, re-run
`shadcn add @tecton/<name> --overwrite` against the registry and copy the
result back in (see the design system's own registry-mirror docs for
running the registry locally), the same way any other shadcn consumer
would update.

Every file here starts with a `// @ts-nocheck` line that is not part of the
registry's own output. The blocks are written against the design system's
own (looser) `tsconfig.json`, and this workspace's `tsconfig.base.json` turns
on `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`, which they
were never written against — a verbatim copy trips dozens of diagnostics
about that mismatch, not about a real bug. `@ts-nocheck` skips checking the
copy's own body while leaving its exported types intact for callers, so this
example's own widgets still get real prop types back. Keep that line when
you re-add a block.
