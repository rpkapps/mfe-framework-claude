---
'@company/mfe-core': minor
'@company/mfe-build': minor
'@company/mfe-rspack': minor
'@company/mfe-nx': minor
'@company/mfe-react': minor
'@company/mfe-angular': minor
'@company/mfe-runtime': minor
'@company/create-mfe': minor
---

A capability route declares its page as one object, and a shell skips a capability it does not know instead of refusing the App.

- A route writes `capability: { name, label, icon? }`, in `staticData` for TanStack Router or in `mfeRouteData({ … })` for Angular. `label` and `icon` are no longer separate fields beside `capability`.
- The build refuses the old flat form (`capability: 'settings', label: '…'`), and the message shows the object to write instead.
- `CapabilityDeclaration` is new in `@company/mfe-core`, and re-exported by both adapters. `MfeStaticData['capability']` and `MfeRouteData['capability']` are typed with it, so the capability names come from `CAPABILITY_NAMES` alone. There is no hand-written copy of the list any more.
- The runtime skips a capability whose name it does not know and keeps the rest of the entry. An App built against a framework that has a newer capability name now loads in an older shell, without that one page. Before, the whole entry was refused. The build still refuses a misspelt name.
