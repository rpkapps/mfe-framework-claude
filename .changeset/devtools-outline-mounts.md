---
'@company/mfe-devtools': minor
'@company/mfe-react': minor
---

The developer tools can outline the micro-frontends on the page: a toggle in the panel header, beside the dock control, draws a box round every mounted App and Widget with its definition id, its kind and its size. Colour carries the kind, so a Widget mounted inside an App is distinguishable from the App around it, and a box is cut down to what its scrolling ancestors still show rather than drawn across the region beside it.

Outlining is persisted with the rest of the panel's settings and survives closing the panel, because looking at the page means putting away the dock covering a quarter of it.

- `@company/mfe-react` now exports `MOUNT_ATTRIBUTE`, `KIND_ATTRIBUTE` and `OVERLAY_ROOT_ATTRIBUTE` beside `SCOPE_ATTRIBUTE`. They are the attributes every mount root already carried (§17); a tool that reads the page rather than the registry can now name them instead of retyping them.
- `DevtoolsSettings` gains `outline`. A stored record without it reads as off.
