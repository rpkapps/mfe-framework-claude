---
'@company/mfe-agent': patch
'@company/mfe-devtools': patch
---

Two fixes for what happens after something goes away, neither of which changes an API:

- `ChatClient.dispose()` now keeps a `sendMessage`, `reload` or `editMessage` still queued behind the turn in flight from running, so a disposed client sends the backend nothing more. `requestApproval` on a disposed client resolves `false` at once, where it used to wait for a card no view would show.
- When the developer tools panel's chunk fails to load, or the panel throws while rendering, `<MfeDevtools />` reports a `mount/failure` to the runtime's diagnostics and renders nothing, instead of throwing into the host page. Turning the tools off and on again fetches the chunk again rather than reusing the failed load.
