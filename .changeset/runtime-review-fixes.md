---
'@company/mfe-runtime': patch
'@company/mfe-react': patch
'@company/mfe-angular': patch
---

Where one App's router takes the page, every other App now hears. `BoundaryNavigator.createBridge()` gives a router a bridge of its own: a push or replace through it is told, a microtask later, to every other subscriber and not to that router, which already knows, so a nested App no longer keeps rendering the page its parent left, nor a parent the page its nested App left. The React and Angular App mounts build their history over one. A push or replace through the navigator itself is told to every subscriber. A navigation whose commit throws after a negotiation now still releases the navigations held while it was negotiated.
