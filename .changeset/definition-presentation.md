---
'@company/mfe-core': minor
'@company/mfe-runtime': minor
'@company/mfe-react': minor
'@company/mfe-rspack': minor
---

`createApp` and `createWidget` now take `title`, `description`, `tags` and `icon`, so a host can name, describe, filter and draw a definition before its container is fetched (§16).

The icon is an imported identifier, not a string: `import { BellIcon } from 'lucide-react'` then `icon: BellIcon`, or `icon` from a `.svg` import. The build resolves it at compile time and publishes the shapes, because the registry crosses an origin boundary and carries data rather than components or markup. No icon library is named in the build: the identifier is followed through ordinary ESM re-exports with the parser, and nothing is evaluated. An identifier the build cannot resolve to a drawable icon fails the build rather than disappearing from the catalogue.

- `IconData` and `IconNode` are new in the core; `NeutralRegistryEntry` gains `description` and `tags`, and its `icon` widens from `string` to `string | IconData`. A host that renders `entry.icon` as text must narrow with `typeof entry.icon === 'string'`.
- `@company/mfe-react` exports `DefinitionIcon`, which draws an `IconData`. It builds the SVG itself and takes no icon-library dependency, and it checks every tag against an allowlist — the registry record arrived from another origin.
- The host normalizer validates an `IconData` shape by shape and quarantines a malformed one; tags it cannot read are dropped rather than failing the entry.

A definition without these fields is unchanged, and the shell's own presentation map still overrides what an author declared.
