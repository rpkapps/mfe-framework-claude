# Review guide

Every change is reviewed against this file before it merges: by its author before opening the PR,
and again by the review job in CI. Report only real problems, each with the file and line, why it is
wrong and the fix. A finding is **blocking** or **minor**. Anything under "Blocking" is blocking.

## Blocking

1. **Correctness.** A bug, a race, a missed cleanup or cancellation, an error path that loses the
   error, or behaviour that breaks something that worked before.
2. **Half-done work.** A TODO or FIXME, a stub, commented-out code, or an option, branch, parameter
   or export that nothing uses yet.
3. **Dead code.** Code, exports, files, types or tests this change made unused and left behind. An
   export counts as used only when the shell, the docs site's code or another package calls it.
   Examples, tests, docs and lint messages do not count.
4. **Docs out of step.** Public API or visible behaviour changed and its canonical page did not, as
   `apps/docs/STYLE.md` assigns them. Or a changed page breaks STYLE.md's recipe template, shows
   one framework where both exist, or describes something the code does not do.
5. **No changeset** for a change to a published package, or one that hides an API or contract change
   (`.changeset/README.md`).
6. **Breaks CONTRIBUTING.md.** Errors without the five parts of a message, a synonym for an existing
   term, a suppression without a reason, a dependency version outside the catalog, `console` in a
   framework package.
7. **Untested behaviour.** New or changed behaviour with no test that would fail without it.
8. **A second way to do one thing.** A new API that overlaps an existing one, or exists only for an
   example or the docs.

## Minor

Readability and naming, comments that narrate the next statement, a simpler equivalent, a long
sentence in docs prose.

## Not findings

Formatting, lint and type errors (CI catches them), and taste with no reason behind it.
