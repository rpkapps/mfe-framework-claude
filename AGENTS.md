<!-- intent-skills:start -->
# TanStack Intent - before editing files, run the matching guidance command.
tanstackIntent:
  - id: "@tecton/react#tecton"
    run: "pnpm dlx @tanstack/intent@latest load @tecton/react#tecton"
    for: "Write UI with @tecton/react (shadcn/ui themed for Tecton, one package). Look a component up with `tecton search \"<what the UI must do>\"`, read it with `tecton docs <id>`, and hold every file to the prop conventions and the finish checklist below. Load before writing or editing any JSX, import, className, prop or handler that uses @tecton/react."
<!-- intent-skills:end -->

# Definition of done

Standards: `CONTRIBUTING.md` (code), `apps/docs/STYLE.md` (docs), `REVIEW.md` (review).

1. `pnpm check` passes. Name any step you couldn't run.
2. Changed public API or behaviour is documented on its canonical page, per STYLE.md.
3. Changed published packages have a changeset.
4. No TODO, stub, commented-out code or unused option.
5. No dead code. Exports need a caller in the shell, docs site or another package, or an
   `api-surface.json` entry (`pnpm api:check`). Never add to `pendingDecision`.
6. The diff is reviewed against `REVIEW.md` in a fresh context before the PR opens.
