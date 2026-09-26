# @example/canvas-01

An MFE container with two definitions: the App `subsurface-canvas` and the
Widget `subsurface-well-3d`. `pnpm run dev` starts the remote on port 3006 and
prints its manifest URL; `build`, `typecheck`, `test`, `lint` and `format` do
what they say. Each runs its own generation step, so `pnpm run generate` is
only ever a recovery command.

## Connecting to the shell

Start the shell, run this in its browser console, and reload.

```js
const key = 'company:mfe:overrides'
const overrides = JSON.parse(localStorage.getItem(key) || '{}')
overrides['subsurface-canvas'] = 'http://localhost:3006/mf-manifest.json'
overrides['subsurface-well-3d'] = 'http://localhost:3006/mf-manifest.json'
localStorage.setItem(key, JSON.stringify(overrides))
location.reload()
```

Overrides are keyed by definition id, so both of this container's are set.
Deleting just one id resets it; unrelated overrides are kept. A change needs a
reload, not a remount: the container's modules are already registered and its
chunks are document-level. The override is a URL only, never a token.

## Configuration

`src/mfe.config.ts` holds the schema and the environment mapping — no values
and no secrets. Your local values live in `.mfe/runtime-config.json`, the one
file in `.mfe/` that is committed. The dev server answers
`runtime-config.json` next to this container's assets with it, which is where
the generated loader fetches it from, and `pnpm run generate` adds any
declared default it lacks without changing a value you set. No build copies
`.mfe/`: a build ships the declared defaults, and a deployment publishes its
own file beside its assets, so no local value is ever built into the container.

Read configuration with `import { config } from '#mfe/config'` and make
authenticated requests with `import { fetch } from '#mfe/fetch'`; the token is
attached only to origins declared `{ api: true }`, and request code never
handles one.
