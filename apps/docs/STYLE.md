# Style guide for the MFE framework docs

This is the rulebook for `apps/docs/content/docs/**` and `docs/design.md`. It is enforceable: every
rule is checkable by a reviewer, and the targets at the end are countable.

## Who reads this and how

Our reader is a React developer who has been handed one piece of a product and told it will load
into a page somebody else owns. They arrive from a search engine or from a link in a ticket, on one
page, with one question, and they have not read the pages before it. They scan before they read —
headings, code blocks, the first line of each paragraph — and they read only the part that answers
the question ([NN/g: 79% of users scan every new page](#sources), and the F-pattern puts the weight
on first lines and first words).

## Page types and templates

One page, one job. A how-to that also teaches theory serves neither reader (Diátaxis).

| Page                                              | Diátaxis type     | Job                                          |
| ------------------------------------------------- | ----------------- | -------------------------------------------- |
| `index.mdx`                                       | orientation (map) | What this is, the two shapes, where to go    |
| the recipes at the root of `content/docs/`        | how-to            | Get the reader's one task done               |
| `reference/*.mdx`                                 | reference         | Look one fact up mid-work                    |
| `how-it-works/*.mdx`, `design.md`, `decisions.md` | explanation       | Understand the system away from the keyboard |

**The consumer rule.** Every sentence on a recipe page answers "what do I do" or "what happens". A
sentence answering "how does the framework do it" moves to a How it works page. Explain a mechanism
only where the reader has to choose because of it, or will see an error caused by it. "Your styles
cannot leak out and the shell's cannot leak in" is enough for a recipe. The `@scope` rule that makes
it true belongs to How it works.

**Recipe template (fixed headings, this order).**

1. **Title** — the task, in the words a reader would search for: `Add a settings page`. Never a
   sentence.
2. **"What you get" opener** — one or two sentences before the first heading: what you get. For a
   shell recipe, name the shape it applies to: "Apps only." or "Apps and Widgets."
3. **`## Steps`** — one `<Steps>` block, one `<Step>` per step. Each step opens with a `###`
   heading, then the code (fenced, with a `title=` naming a real file from `examples/`), then at
   most one sentence.
4. **`## Check it works`** — where it appears in the shell, or the test to run. Two to four
   sentences, or a short list.
5. **`## Errors`** — only the messages this task can produce. Each is a
   `<Callout type="error" title="…">` holding the first sentence of the real message verbatim, then
   a bold `**Fix.**` of one or two sentences. Omit the section when the task produces no error.
6. **`## Related`** — three to five links, each with a reason of ten words or fewer: the
   neighbouring recipes, the reference entry, the How it works page.

Length: 200 to 500 words of prose. A recipe that runs longer is two recipes.

Use at most three `<Term>` definitions per page, on first use. Every other term links to the
glossary.

**Explanation template (How it works, the design map).** Title, then one paragraph saying which
questions this page answers and who it is for. Then one section per view of the system, each: the
`<Diagram>` with its text equivalent, then at most five short paragraphs of _why_, then a link to
the decision that argued it. No API signatures, no option tables, no error messages — those belong
to the recipes and the reference.

## Sentence rules

**1. One idea per sentence.** Comprehension falls off a cliff as sentences lengthen: under 8 words
readers get 100%, at 14 words over 90%, at 43 words under 10% (American Press Institute / Wylie).

> **Now:** "When a container's range accepts a copy the host already loaded, Module Federation hands
> it that copy, and when no loaded copy satisfies the range the container loads the one it bundled
> instead of failing, which keeps containers from separate repositories working as versions drift."
>
> **Rewrite:** "A container asks for a range. Module Federation hands it a loaded copy that
> satisfies the range. When none does, the container loads the copy it bundled. So a container
> from another repository keeps working when versions drift."

**2. Average under 18 words, no sentence over 25.** Plain-language guidance sets an average of 20
and a hard ceiling. Shorter is better still for a scanning reader (plainlanguage.gov, Google
"write for a global audience").

> **Now:** "This page is the machinery that stops that, almost all of which runs without you writing
> a line of CSS: you ship no stylesheet entry, no `postcss.config` and no theme variables, and your
> build generates a stylesheet from the classes you used and wraps it in a CSS `@scope` rule keyed
> on your definition id." (55 words)
>
> **Rewrite:** "You write no CSS configuration. Your build collects the classes you used, generates
> one stylesheet, and wraps it in a CSS `@scope` rule keyed on your definition id."

**3. Active voice, present tense, second person.** Say who does what. Passive voice hides the actor
(Google style).

> **Now:** "The consumer's props are split into inputs and `on…` handlers."
>
> **Rewrite:** "The provider splits the consumer's props into inputs and `on…` handlers."

**4. Put the condition before the instruction.** The reader can skip an instruction that does not
apply to them (Google style, "clause order").

> **Now:** "Declare `https://reports.example.test` with `{ api: true }` if it is your API, or leave
> it undeclared if it must never receive the session bearer token."
>
> **Rewrite:** "If this is your API, declare `https://reports.example.test` with `{ api: true }`. If
> it must never receive the session token, leave it undeclared."

**5. No semicolons.** A semicolon joins two sentences. Write them as two (Microsoft: short sentences
and fragments are easier to scan).

> **Now:** "Each guide defines its own terms where it uses them; this page repeats the definitions
> in one place so you can look one up without reading around it."
>
> **Rewrite:** "Each guide defines its own terms where it uses them. This page repeats every
> definition in one place, so you can look one up on its own."

**6. At most one em-dash aside per paragraph.** An aside inside a clause forces the reader to hold
the sentence open (NN/g: chunk, don't nest).

> **Now:** "It fetches the registry, owns the document — header, theme, session, the routes above
> your boundary — and mounts containers into itself."
>
> **Rewrite:** "It fetches the registry, owns the document, and mounts containers into itself. The
> document includes the header, the theme, the session, and the routes above your boundary."

**7. Define a term by what it is, never by what it is not.** Reference prose describes. It does not
argue by contrast (Diátaxis, reference vs explanation).

> **Now:** "The `<Term>shell</Term>` is the one application on the page that is not itself listed in
> the registry."
>
> **Rewrite:** "The `<Term>shell</Term>` is the application that serves the page, owns the document,
> and mounts containers into it. It is the only application on the page with no registry entry."

**8. Everyday word first. Give the code's word in parentheses when an error message uses it.**
Jargon is the thing expert readers complain about most (NN/g, "Plain language is for everyone, even
experts", and plainlanguage.gov).

> **Now:** "a failure **sets it aside** — with a reason and an error — rather than dropping it"
>
> **Rewrite:** "The shell sets the entry aside and records the reason. The registry lists it under
> `rejected`. Every other entry still loads."

| Write this               | Instead of         | Keep the code word where                      |
| ------------------------ | ------------------ | --------------------------------------------- |
| set aside                | rejected           | registry field and messages: `rejected`       |
| limited to, cleared when | fenced             | nowhere — no message uses "fenced"            |
| boundary, edge           | seam               | nowhere                                       |
| stored record            | envelope           | messages: "a framework envelope at version 1" |
| declares                 | advertises         | nowhere — no message says "advertises"        |
| ends, replaced           | retired            | repair text: "a retired session's data"       |
| creates, issues          | mints              | nowhere                                       |
| deletes                  | physically removes | nowhere                                       |
| checks                   | screens            | nowhere                                       |
| screen, panel            | surface            | nowhere                                       |
| registry entry           | descriptor         | nowhere — the error code is `invalid-entry`   |
| takes ownership of       | claims             | nowhere                                       |

**9. No aphorisms or slogans as explanations.** A memorable phrase is not an answer. State the
mechanism (Write the Docs: documentation is for the reader, not the writer).

> **Now:** "A record belongs to the browser, so the browser decides."
>
> **Rewrite:** "The framework keeps a stored record until something removes it. A sign-out does not
> remove it, so the next user of this browser profile reads it."

**10. No "which is why", "that is", "in other words" chains.** One clause should not need a second
to rescue it (Microsoft: bigger ideas, fewer words).

> **Now:** "`basePath` is the literal string form of the boundary; handing it to
> `createRouter({ basepath })` makes every route, `Link` and `navigate` relative to it, which is why
> the App's own routes are written as `/assets` and `/wells/$wellId` and the mount prefix never
> appears again."
>
> **Rewrite:** "Pass `basePath` to `createRouter({ basepath })`. Every route, `Link` and `navigate`
> is then relative to it. Write your routes as `/assets` and `/wells/$wellId`: the mount prefix
> never appears in your code."

**11. More than two parallel items go in a list or a table.** Parallel facts are what tables are for
(Microsoft, "scannable content").

> **Now:** "The real DAG, as the manifests have it: the core depends on nothing in the workspace;
> the host on the core; the two adapters each on the core and the host, never on each other; the
> developer tools on the core, the host and the React adapter; `@company/mfe-rspack` on the core
> alone, since it runs in the build rather than on the page; the scaffold and the lint plugin on
> neither."
>
> **Rewrite:** a two-column table, `Package` / `Depends on`, one row each.

**12. A heading states the task or the answer, in words the reader would search for.** Headings are
the entry points a scanner uses, and question headings work when you know the question
(plainlanguage.gov; NN/g F-pattern).

> **Now:** `## Where the rest is` · `## The system at rest` · `## Why the line is drawn at the URL`
>
> **Rewrite:** `## Reference pages: glossary, decisions, design map` · `## What is deployed, and
where` · `## Why a URL decides App or Widget`

**13. Front-load every sentence.** Put the keyword in the first few words. The reader's eye fixates
there and moves on (NN/g F-pattern: first words of each line get the most fixations).

> **Now:** "Before you write a line of code you make one decision, and everything else follows from
> it."
>
> **Rewrite:** "One decision comes first: App or Widget. Everything else follows from it."

## Structure rules

- **Answer first.** The first sentence of a page or section gives the answer, not the run-up.
  Rationale comes after (inverted pyramid, NN/g).
- **Code before prose** in a how-to section. The smallest complete, copy-pasteable example, with a
  `title=` naming the real file. This is what practitioners praise in Stripe and Twilio docs.
- **One concept per section.** If a section needs two `<Term>` definitions, it is two sections.
- **Progressive disclosure.** Lead with the common case. Push the rest into a later section, a table
  or a linked decision entry. The docs site has no `Collapsible` component today: add one to
  `src/components/docs-blocks.tsx` before you rely on it.
- **Every section is skimmable by its first sentence.** Reading only the first sentence of each
  section must give a correct, if shallow, picture of the page.
- **Tables for parallel facts** — options, failures, comparisons. Prose for causes.
- **Callouts only for warnings and one-line notes**, plus the error-and-fix pattern. A callout longer
  than four lines is a section.
- **Every page is page one** (Write the Docs / Mark Baker). Define the terms the page uses, link the
  rest, and assume no page was read before this one.
- **Paragraphs of at most four sentences.** One idea each.

## Diagram rules

- A box holds a **name of four words or fewer** and at most **one subtitle of eight words or fewer**.
- An arrow label is **three words or fewer**, and says what flows or what is called — never "uses".
- **Sequence steps are numbered**, and the numbers are referenced in the text equivalent.
- **A legend is required when colour carries meaning** (C4: the notation should be self-describing,
  but every diagram still gets a key).
- **One idea and one abstraction level per diagram**, and **at most 12 boxes**. A thirteenth box is a
  second diagram.
- **Everything else goes in the page's text equivalent**, inside `<Diagram>`. The text equivalent is
  prose under these same sentence rules. It is not a transcript of every label.
- Prose and picture must not disagree: if the text equivalent contradicts the SVG, fix the SVG.

## Reviewer checklist

Answer yes to all of these before approving a docs change.

1. Is the page exactly one Diátaxis type?
2. Does the opener say what the thing is and what the reader can do after reading, in three
   sentences or fewer?
3. Does every how-to section start with code or an instruction, not a reason?
4. Is every sentence 25 words or fewer?
5. Is the page average under 18 words per sentence?
6. Are there zero semicolons in prose?
7. Does every paragraph have at most one em-dash aside?
8. Is every term defined by what it is?
9. Is every piece of codebase jargon either replaced or given in parentheses beside a plain word?
10. Does every heading name a task or an answer a reader would search for?
11. Does the first sentence of each section name that section's topic?
12. Are all parallel facts of three or more items in a list or a table?
13. Does every error have a `**Fix.**`?
14. Does every diagram obey the box, label and count limits, with the rest in the text equivalent?
15. Does the page end with a "Related" list of three to five links?
16. Does every sentence on a recipe page answer "what do I do" or "what happens"?

## Measurable targets

Measured over prose only: exclude code fences, tables, quoted error messages and diagram text
equivalents from the averages, and hold the text equivalents to the same ceilings.

| Target                                                    | Value                | Where we are now                                   |
| --------------------------------------------------------- | -------------------- | -------------------------------------------------- |
| Average sentence length, per page                         | **< 18 words**       | 17.3–20.5 (guides), 26.8 (design map)              |
| Longest sentence, per page                                | **≤ 25 words**       | 40–71 words                                        |
| Sentences over 25 words                                   | **0%**               | 19–29% (guides), 45% (design map)                  |
| Flesch reading ease, prose paragraphs                     | **≥ 50**             | below the technical-docs 40–60 band at the top end |
| First sentence of a section names its topic               | **100% of sections** | not tracked                                        |
| Sentences before the first code or instruction, in a step | **≤ 2**              | commonly 4–6                                       |
| Recipe length                                             | **200–500 words**    | not tracked                                        |
| Paragraph length                                          | **≤ 4 sentences**    | not tracked                                        |

## Sources

- **Diátaxis** — the four documentation types, and why one page must not mix them:
  https://diataxis.fr/ (see also https://diataxis.fr/how-to-guides/ and
  https://diataxis.fr/reference-explanation/)
- **Google developer documentation style guide** — active voice, present tense, second person,
  condition-before-instruction, short sentences for a global audience: https://developers.google.com/style
- **Microsoft Writing Style Guide** — top 10 tips, "bigger ideas, fewer words", scannable content:
  https://learn.microsoft.com/en-us/style-guide/top-10-tips-style-voice
- **Federal plain language guidelines** — average sentence length, everyday words, active voice,
  headings as questions, organise by the reader's questions: https://www.plainlanguage.gov/guidelines/
- **NN/g, How Users Read on the Web** — 79% scan; concise +58%, scannable +47%, combined +124%
  measured usability: https://www.nngroup.com/articles/how-users-read-on-the-web/
- **NN/g, F-shaped pattern** — first lines and first words get the fixations, so front-load:
  https://www.nngroup.com/articles/f-shaped-pattern-reading-web-content/
- **NN/g, Plain Language Is for Everyone, Even Experts** — domain experts also want jargon-free,
  scannable text: https://www.nngroup.com/articles/plain-language-experts/
- **Write the Docs, Documentation principles** — ARID, write for the reader, every page is page one:
  https://www.writethedocs.org/guide/writing/docs-principles/
- **American Press Institute / Ann Wylie, sentence length and comprehension** — 8 words: 100%;
  14 words: >90%; 43 words: <10%: https://www.wyliecomm.com/how-long-should-a-sentence-be/
- **Flesch reading ease in technical writing** — the 40–60 band for technical docs, and the formula's
  limits: https://clickhelp.com/clickhelp-technical-writing-blog/flesch-reading-ease-formula-a-complete-guide/
- **C4 model, notation** — a box carries a name and a short description, arrows carry specific
  labels, one abstraction level per diagram, always a legend: https://c4model.com/diagrams/notation
- **What practitioners praise in Stripe and Twilio docs** — task-first sections, copy-paste examples,
  consistent templates, progressive disclosure:
  https://readme.com/resources/why-these-api-docs-are-better-than-yours-and-what-you-can-do-about-it
