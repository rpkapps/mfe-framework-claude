<!-- intent-skills:start -->
# TanStack Intent - before editing files, run the matching guidance command.
tanstackIntent:
  - id: "@tecton/react#tecton"
    run: "pnpm dlx @tanstack/intent@latest load @tecton/react#tecton"
    for: "Write UI with @tecton/react (shadcn/ui themed for Tecton, one package). Look a component up with `tecton search \"<what the UI must do>\"`, read it with `tecton docs <id>`, and hold every file to the prop conventions and the finish checklist below. Load before writing or editing any JSX, import, className, prop or handler that uses @tecton/react."
<!-- intent-skills:end -->

# Definition of done

A change is finished only when all of these hold. The PR template repeats them as boxes: tick each
one, or say why it does not apply.

1. **Checks pass.** Run `pnpm check`, and `pnpm docs:check` when docs changed. If a step cannot run
   where you are (a cloud session without the Tecton checkout, say), run the steps that can and name
   the ones you skipped.
2. **Docs match the code.** A change to public API or visible behaviour updates its canonical page,
   as `apps/docs/STYLE.md` assigns them: the task guide, the `reference/` page, the package README.
   Follow STYLE.md's templates and sentence rules, and show React and Angular where both exist.
3. **A changeset** describes every change to a published package (`.changeset/README.md`).
4. **Nothing half-done.** No TODO or FIXME, no stub, no commented-out code, no option, branch or
   parameter that nothing uses. Finish it in this change or leave it out.
5. **No dead code.** Delete what your change made unused. A public export needs a caller that
   ships: the shell, the docs site's code or another package. Examples, tests, docs and lint
   messages do not count. Authoring API that only containers call goes in `api-surface.json` with
   its docs page and an example that calls it. `pnpm api:check` enforces this. Never add to its
   `pendingDecision` list to make it pass.
6. **Reviewed.** Before you open the PR, review the whole diff against `REVIEW.md` in a fresh
   context, such as a subagent or `/code-review`, and fix what it finds. CI reviews every PR again.

Standards live in `CONTRIBUTING.md` (code), `apps/docs/STYLE.md` (docs) and `REVIEW.md` (review).
Read them before changing code or docs.
