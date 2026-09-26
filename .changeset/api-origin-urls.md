---
'@company/mfe-build': patch
'@company/mfe-rspack': patch
---

A configuration field declared with `{ api: true }` must be an absolute http(s) URL, and `#mfe/fetch` no longer throws a bare `TypeError: Invalid URL` on one.

- The build refuses an API field whose schema is not a URL (`z.url()` or `z.string().url()`), since `z.string()` admits a relative `/api` that has no origin, and a default that is not an absolute http(s) URL.
- `#mfe/config` refuses a deployed value that is not an http(s) URL with a `config/invalid` error naming the variable, as the host's `checkConfigField` now does for a spec with `api: true`.
- `#mfe/fetch` declares no origin and no base for an optional API field the deployment left unset, instead of throwing on `new URL(undefined)`.
