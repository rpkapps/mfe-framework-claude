---
'@company/mfe-core': minor
'@company/mfe-host': minor
'@company/mfe-react': minor
---

An App refuses a navigation with TanStack's own `useBlocker`, including the
navigations its router never sees.

An editor with unsaved changes is the only thing that knows the changes exist,
and the navigation that discards them is usually one its router does not own — a
link in the shell's chrome, another application in the finder, the browser's back
button. Those move the shell's router, so the App's blockers were never asked.

The author now writes nothing framework-specific:

```tsx
const blocker = useBlocker({
  shouldBlockFn: () => isDirty,
  enableBeforeUnload: () => isDirty,
  withResolver: true,
})

<Dialog isOpen={blocker.status === 'blocked'}>
  <Button onPress={blocker.reset}>Keep editing</Button>
  <Button onPress={blocker.proceed}>Discard and leave</Button>
</Dialog>
```

The mount registers one delegate with the host's navigator and answers it out of
the App's own blockers, so a shell navigation arrives as an ordinary
`shouldBlockFn` call with `current`, `next` and `action` resolved against that
App's route tree. A target outside the App matches no route there, which is how
an App tells a step inside itself from a jump to another application.

Four defects had to be fixed for any of it to work, and all four were silent:

- **`useBlocker` did nothing at all inside an App.** The boundary history is
  built with `createHistory`, which returns a no-op from `block()` unless it is
  given `setBlockers` and consults `getBlockers` on every push. It was given
  neither, so every registration succeeded and none was ever asked — including
  for the App's own routes.
- **Every entry an App pushed had no history state.** An App's history is built
  over `runtime.navigator`, whose `push` and `replace` took only a path and
  dropped the state. Neither history on the page could then compute a position
  delta: a browser back was classified as a zero-length `GO`, and a refused one
  had nothing to roll back by, so declining it left the URL on the page the user
  had tried to leave.
- **An App's history stopped hearing the URL after its first remount.** It
  subscribed to the navigation bridge from its constructor, which runs in a
  `useMemo`, and unsubscribed from an effect cleanup. React tears an effect down
  and sets it up again without re-running that memo — StrictMode does it on
  every mount — so from then on browser back and forward changed the address bar
  and left the page where it was. Construction is now pure; `attach()` listens,
  and the effect that ends it starts it.
- **A mount heard a browser back before anyone had been asked about it.** The
  browser moves the URL first and the host negotiates afterwards, so a mount
  told about it straight away left the very page the user was still being asked
  whether to leave — the confirmation appeared over the next screen, with the
  unsaved form already gone. `BoundaryNavigator.subscribe` now holds an external
  navigation while one is being negotiated and releases it only if it proceeded;
  a refusal is followed by the host restoring the URL, which arrives as an event
  of its own.

Also in this release:

- `BoundaryNavigator` gains `readState`, `go`, and `state` parameters on `push`
  and `replace`; a host supplying its own `NavigationBridge` is unaffected.
- `NavigationBlocker` gains an optional `shouldBlockUnload()`, and the navigator
  a `wantsUnloadPrompt()`. A host should ask that rather than counting
  registrations: counting armed the browser's "leave site?" prompt on every
  reload of any page with a blocker mounted, whether or not anything was unsaved.
- `NavigationIntent` gains an optional `action`, and `createNavigationIntent` an
  optional fourth argument, so a host that knows what the user did can pass it
  on. Refusing a back button while allowing a redirect is a distinction an author
  is entitled to make.
- One mount may now register more than one blocker. They were keyed by mount
  token, so a second registration silently deleted the first.
- `useNavigationBlock` stays, scoped to mounts with no router of their own — a
  Widget, or anything mounted outside one — and now answers the unload question
  from its own condition instead of always saying yes.
- `LazyWidgetProps` gains an optional `pending` slot; see the mount-isolation
  changeset for what it is for.

A host opts in by routing its own navigations through
`runtime.navigator.requestNavigation(...)`; the shell in this repository does it
with TanStack Router's `useBlocker`, forwarding the action it was given.
