---
'@company/mfe-react': patch
---

Three defects a real page found: a blank region when switching App, a page that
flickered when one Widget loaded, and an override that deleted the trail.

- **Switching from one mounted App to another left the region blank.**
  `AppHost` reconciled a single loader across the change, so for one render the
  new App's definition was paired with the _previous_ App's mount — the
  author's router factory was handed the old boundary, matched nothing, and
  rendered nothing. The loader is now keyed by the App and its boundary, which
  makes the change a remount: the old mount is disposed, the new one starts
  clean and the host's Suspense boundary covers the gap. Any shell whose users
  switch application from a finder or a palette hit this on every switch.

- **A Widget's load suspended the whole consuming page.** Nothing caught the
  suspension between the Widget and whatever boundary the page happened to
  have, so mounting one Widget — or retrying one that failed — replaced the
  entire page with its fallback and flickered everything back in afterwards.
  `lazyWidget` and `DynamicWidget` now own a Suspense boundary each, and take a
  `pending` slot for what fills that Widget's box meanwhile (a skeleton, in
  practice). `pending` joins `fallback` as a reserved control prop and is never
  forwarded to the Widget as an input.

- **`useBreadcrumbs([])` deleted the App's route-derived crumbs.** The shape
  every caller writes is `useBreadcrumbs(inFlow ? steps : [])`, and an empty
  array installed an empty override: for the whole time the flow was not
  running the trail silently lost the current page's own name. An empty array
  is now _no override_. An App that contributes no crumbs at all still says so
  once, with `contributesBreadcrumbs: false` on its definition.
