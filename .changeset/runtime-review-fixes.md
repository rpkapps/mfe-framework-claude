---
'@company/mfe-runtime': minor
'@company/mfe-react': patch
'@company/mfe-angular': patch
---

Where one App's router takes the page, every other App now hears. `BoundaryNavigator.createBridge()` gives a router a bridge of its own: a push or replace through it is told, a microtask later, to every other subscriber and not to that router, which already knows, so a nested App no longer keeps rendering the page its parent left, nor a parent the page its nested App left. The React and Angular App mounts build their history over one. A push or replace through the navigator itself is told to every subscriber. A navigation whose commit throws after a negotiation now still releases the navigations held while it was negotiated.

A shortcut's letters and digits now name keys rather than what the layout types on them: where a layout types something other than a Latin character, as a Cyrillic one does for `mod+k`, or Option does on a Mac, the key is read from `event.code` (`KeyK` is `k`, `Digit1` is `1`), while Ctrl with Alt, which is how Windows reports AltGr, keeps the symbol it types. A keydown with no `key`, such as autofill sends, or one an input method is composing, is ignored rather than throwing, and a held key's repeats run nothing: a repeat of a shortcut's keys is still claimed, so the browser does not act on it.

An approval policy that returns anything but `'approve'`, `'ask'`, `{ deny: reason }` or `undefined`, such as `false` or `'deny'`, now denies the agent's call and is reported, as a policy that throws is; it used to run the call.

`runtime.agentContext.read()` no longer throws on a search param named like an object's own member, such as `?constructor=x`, `?toString=1` or `?__proto__=a`, which broke every chat turn on that page; each is read as an ordinary param.
