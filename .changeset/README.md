# Changesets

Framework package versions, release notes and internal dependency bumps are
managed here.

Add a changeset with `pnpm changeset` in the same commit as the change it
describes. Record **public API and contract changes explicitly** — a consumer
reading the changelog should be able to tell whether their code still compiles
and still behaves the same way, without diffing the source.

The shell and the examples are ignored: they are not published.

Before publishing, verify the packed artifacts rather than the working tree:
export paths resolve, declarations are emitted, the generated aliases are
present, and a scaffolded project consumes the published packages successfully.
