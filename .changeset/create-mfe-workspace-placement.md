---
'@company/create-mfe': minor
---

The scaffold works wherever its pnpm workspace installs packages, and refuses anywhere else.

- The generated `tsconfig.json` extends the workspace's `tsconfig.base.json` by the path from the new project, found through the nearest `pnpm-workspace.yaml`, instead of always `../../tsconfig.base.json`.
- A directory the workspace's `packages` globs do not match — outside any workspace, the workspace root itself, or a path a `!` glob excludes — is refused before anything is written, with a message naming the globs, because its `workspace:*` and `catalog:` dependencies would not install there. So is a workspace without a `tsconfig.base.json`.
- Without `--id`, the id is the directory's own name after resolving it, so `.`, a trailing separator and Windows paths name the definition correctly.
- A Widget's generated identifiers are valid TypeScript for every valid id: one that would start with a digit is prefixed (`3d-viewer` exports `widget3dViewer` and renders `Widget3dViewer`), and one that is a reserved word or a name the generated files already use is suffixed (`new` exports `newWidget`).

**Breaking:** `appTemplate` and `widgetTemplate` take a `tsconfigBase` option, the relative path the generated `tsconfig.json` extends.
