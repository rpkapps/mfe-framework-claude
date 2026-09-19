---
'@company/mfe-react': minor
---

`useNavigationBlock`: a mount can refuse a navigation that would lose its work.

An editor with unsaved changes is the only thing that knows the changes exist,
and the navigation that discards them is usually one it does not own — a link in
the shell's chrome, another application in the finder, the browser's back
button. The host's navigator has always been able to negotiate this; there was
no way for an App to take part in it from React.

```tsx
const block = useNavigationBlock(isDirty)

<Dialog isOpen={block.pending !== null}>
  <Button onPress={block.stay}>Keep editing</Button>
  <Button onPress={block.proceed}>Discard and leave</Button>
</Dialog>
```

Contract notes for consumers:

- The argument is read per navigation: pass a boolean, or a predicate that
  receives the `NavigationIntent` and can allow a move within this App's
  boundary while refusing one that leaves it.
- `pending` is the intent awaiting an answer, or `null`. The mount stays
  mounted throughout, so its own UI — and whatever is unsaved in it — is still
  there while it asks. The host draws nothing and decides nothing.
- Nested mounts are asked innermost first and the first refusal stops the
  negotiation, so an inner editor is never overruled by the App around it.
- A mount that unmounts while it is being asked answers `proceed` on cleanup
  rather than leaving the host negotiating forever.
- `NavigationIntent` and `BoundaryLocation` are now re-exported from
  `@company/mfe-react`, because an author reads them inside this hook.
- `LazyWidgetProps` gains an optional `pending` slot; see the mount-isolation
  changeset for what it is for.

A host opts in by routing its own navigations through
`runtime.navigator.requestNavigation(...)`; the shell in this repository does it
with TanStack Router's `useBlocker`, and also turns a registered blocker into
the browser's `beforeunload` prompt, which a reload does not otherwise reach.
