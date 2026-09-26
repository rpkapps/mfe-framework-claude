---
'@company/mfe-build': patch
'@company/mfe-rspack': patch
---

Generating deletes what an earlier run generated and this one no longer does. A renamed or removed Widget left its `.mfe/entries/widgets/<id>.ts` and `.mfe/widgets/<id>.contract.ts` behind, and removing `src/mfe.config.ts` left `.mfe/config.ts`, each failing `tsc` on an import that no longer resolves. A plan now lists its files in `.mfe/.generated-files.json`, and writing a changed list deletes the files the one before named and this one does not. A file no plan listed, such as the developer's `.mfe/runtime-config.json`, is never deleted.
