---
'@company/mfe-devtools': minor
'@company/mfe-host': minor
'@company/mfe-react': minor
---

Add `@company/mfe-devtools`: a developer tools overlay for an MFE shell.

A floating trigger and a panel that docks to any of the four edges, enabled by
`localStorage["company:mfe:devtools"]` or `?devtools=1`. The panel writes the
boot-time manifest overrides — pick a definition, give it a dev server origin,
apply and reload — and shows what the registry accepted or rejected. It ships in
production bundles and is gated at runtime rather than stripped with `DEV`,
because a deployed page is where repointing a container is hardest; a page that
has not opted in pays a storage read and fetches no chunk. See decisions.md §22.

`@company/mfe-host` gains `writeDevOverrides`, beside the reader that has always
been there, so the override key stays owned by one directory.

`@company/mfe-react` gains `containerNameOf`, which reports the federation
container a registry entry is exposed from without a caller casting the
adapter-private payload for itself, and `createMfeRuntime` now calls
`findConflictingContainerOverrides` — exported since the beginning and never
called — so two definitions of one container pointed at different URLs are
diagnosed at boot instead of one of them silently doing nothing.
