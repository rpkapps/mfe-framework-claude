# User storage: React and Angular

Each app declares what it stores in one `src/storage.ts` of keys. The React Lab owns its `units`
and `well-selection` keys in the user area. The Angular inspection Widget reads them with
`storedKey.from('lab', ...)`, bringing its own schema and defaults, and owns its own `brief`. Only
the owner of a key can write it. This folder supplies the shared well data and the local API's
file repository. The shell's browser adapter is `apps/shell/src/user-storage-adapter.ts`, passed
to `createMfeRuntime({ storage: { user } })` in `apps/shell/src/boot.tsx`.

## Run it

From the repository root:

```sh
pnpm build
pnpm generate
pnpm dev
```

Open <http://localhost:3000/lab/user-storage>. The page mounts two independent MFEs side by side:

- **Survey review:** the React Lab App selects a well and reviews its surveys.
- **Inspection planner:** an Angular Widget from the Fieldwork container reads that selection
  and prepares an inspection brief. It receives no selection or units as props.

1. Choose **North Ridge 42** in React. Both panels show that well and its October survey.
2. Turn on **Compare with baseline**, change the survey or choose **Feet**. Angular reads each
   change at once; it has no controls for Lab's values, because it cannot write them.
3. Choose **Prepare inspection**. Angular saves a brief it owns, for the selected well and survey.
4. Close the inspection panel, change the well in React and reopen the panel. Angular reads
   the current selection, and its brief comes back when the well and survey match again.
5. Reload the shell. Both apps mount after the user's values have loaded, so the saved selection
   and brief are there at first render. **Clear selected well** clears both panels.

The same Angular Widget also appears at <http://localhost:3000/fieldwork/user-storage>. The well
names and measured depths are sample survey data; user storage holds only the selection, the
units and the brief. The shell saves its theme preference the same way, as `@host › theme`.

## Find the code

| Responsibility                     | File                                                  |
| ---------------------------------- | ----------------------------------------------------- |
| Lab-owned keys                     | `examples/lab/src/storage.ts`                         |
| Lab reads and the Widget's own key | `examples/fieldwork/src/storage.ts`                   |
| React owner hooks                  | `examples/lab/src/user-storage-page.tsx`              |
| TanStack Router loader             | `examples/lab/src/routes/user-storage.tsx`            |
| Angular reader and owner signals   | `examples/fieldwork/src/well-inspection.component.ts` |
| Angular route resolver             | `examples/fieldwork/src/user-storage.resolver.ts`     |
| Browser adapter                    | `apps/shell/src/user-storage-adapter.ts`              |
| Local API routes                   | `tools/dev/api.mjs`                                   |
| File repository                    | `examples/user-storage/server.mjs`                    |

## The API

The adapter speaks three routes, one row per user, owner and key, each with its own revision:

| Request                                  | Response                                                             |
| ---------------------------------------- | -------------------------------------------------------------------- |
| `GET /api/user-storage`                  | everything of the user: `{ [owner]: { [key]: { v, d, revision } } }` |
| `PUT /api/user-storage/<owner>/<key>`    | body `{ v, d }`; the stored row, its revision bumped                 |
| `DELETE /api/user-storage/<owner>/<key>` | `null` once removed                                                  |

The owner and key are URL-encoded, so the shell's `@host` is `%40host`, and a `perInstance` key
is `<name>@<instanceId>`. The backend knows no schema: it stores `{ v, d }` as it is given, and
each reader validates the value with its own key.

The adapter has no `sync`, so values change only through this tab's own saves and the next load.
A shell that wants other tabs and devices to catch up adds one, for example by polling:

```ts
sync: (storage, signal) => {
  const id = setInterval(() => {
    void fetch(API, { signal })
      .then(response => response.json())
      .then(state => storage.replace(state))
  }, 60_000)
  signal.addEventListener('abort', () => clearInterval(id))
},
```

## Local persistence and identity

The local API writes `.mfe/user-storage-demo/records.json` in the repository root, as
`{ [user]: { [owner]: { [key]: row } } }`. Stop the API before deleting that file to start again
with defaults. Each accepted save flushes the file and atomically renames it; the repository
serializes saves, and the last save of a key wins.

This development API has no sign-in service. It assigns every request the shell's local demo
identity, `u-2841`, on the server, and refuses a request that names a `scope` or `user`, or a
value carrying anything besides `v` and `d`: identity is never the browser's to choose. It does
not check which app is writing either; the framework allows only a key's owner to write it, in
the page. A production backend derives the user from its authenticated session, authorizes every
read and write against it, and uses a transactional database.

## Checks

```sh
pnpm --filter @example/user-storage-demo test
pnpm --filter @example/user-storage-demo typecheck
pnpm --filter @example/lab test
pnpm --filter @example/fieldwork test
```
