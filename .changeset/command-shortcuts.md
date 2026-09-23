---
'@company/mfe-core': minor
'@company/mfe-runtime': minor
'@company/mfe-react': minor
'@company/mfe-angular': minor
---

A command can carry a keyboard shortcut, and the runtime's command registry reads the keys.

- **`CommandRegistration.shortcut`** is a chord such as `'mod+s'` or a sequence such as `'g r'`. `mod` is ⌘ on Apple platforms and Ctrl elsewhere. An unreadable one is rejected with `command/duplicate-name`, like any other invalid registration.
- **`CommandEntry.shortcut`** is the normalized spelling (`'Shift+Mod+K'` becomes `'mod+shift+k'`), present only while the shortcut can fire.
- **`CommandRegistry.handleKeyDown(event)`** is what a host's one `keydown` listener calls. A match runs through the same path as `execute`, so `canExecute` and the denial notice still apply. It returns `unmatched`, `pending` (a sequence has begun), `ambiguous` or `matched` with the execution.
  - An unmodified key typed into an input, textarea, select or contenteditable element stays typed, also when a component re-dispatched it from a focused field onto another element.
  - The host page's shortcuts fire everywhere. An App's fire while the page is inside its boundary. A Widget's is ignored with a diagnostic.
  - A container shortcut that equals, begins or extends one of the host page's is ignored with a diagnostic.
  - Two registrations whose keys can be pressed for at the same time are reported, and a key press that could mean either runs neither.
- **Breaking:** `CommandRegistry.register(definitionId, mountToken, registration)` is now `register(owner, registration)`, where `owner` is `{ definitionId, mountToken, kind, basePath }`; a `MountContext` is one. `useCommand` and `injectCommand` pass `shortcut` through unchanged.
- `@company/mfe-runtime` exports `parseShortcut` for a host that draws or checks a shortcut, and `CommandRegistryOptions.readPathname`, which `createMfeRuntime` and the memory runtime wire to the navigator.
