---
'@company/eslint-plugin-mfe': patch
---

`mfe/no-widget-global-effects` describes the repair an author can actually perform.

- The `history`, `title` and `headMetadata` messages named `ctx.emit(...)` and a "host document-metadata API". A Widget's render props are `{ inputs, emit }` and there is no document-metadata API: each message now says to declare the event in the Widget's `events` contract, `emit` it from the render props, and let the owning App act on the `onX` prop it arrives as.
- `DEFAULT_ROUTER_FILES` is exported, so `mfe.author({ routerFiles: mfe.DEFAULT_ROUTER_FILES })` — which the README has always shown — resolves to the patterns it names instead of `undefined`.
