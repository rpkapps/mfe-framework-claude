---
'@company/mfe-react': patch
---

A React App's breadcrumbs link under its boundary. A crumb's `href` was the router match's `pathname`, which TanStack reports without the router's basepath, so an App at `/operations` published `/wells` for its Wells page and the shell's trail linked out of the App. The href is now the mount's `basePath` joined to the match's path, with no doubled or trailing slash, as the Angular adapter's already was; an App mounted at `/` is unchanged.
