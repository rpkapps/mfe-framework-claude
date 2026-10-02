---
'@company/mfe-build': minor
'@company/create-mfe': patch
'@company/mfe-nx': patch
---

Read MFE definition versions from direct package.json imports during static discovery. React and Angular starters now import their package version so a release only needs one version update. Existing inline versions remain supported.
