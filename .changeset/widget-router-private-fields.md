---
'@company/eslint-plugin-mfe': patch
---

`mfe/no-widget-global-router` reports two navigations it missed: through a private field (`readonly #router = inject(Router)`, then `this.#router.navigate(...)`), and through a field or variable declared below the method or function that navigates with it. Calls are now judged once the whole file has been read.
