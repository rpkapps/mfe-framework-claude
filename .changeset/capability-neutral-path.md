---
'@company/mfe-rspack': patch
---

A capability route's `path` is published in the syntax an App's `routes` are: a capability marked on `createFileRoute('/_auth/settings')` published `/_auth/settings`, a URL the App does not serve, and is now `/settings`, as the same route's entry in `routes` is. A pathless layout or a group adds no segment, and a parameter is written `:id`. A marked route whose path that syntax cannot write, such as `/files/{$name}.json`, fails the build naming the route.
