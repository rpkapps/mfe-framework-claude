# @example/canvas-01

An MFE App. Its id is `canvas-01`. `pnpm run dev` starts the remote and prints its
manifest URL; `build`, `typecheck`, `test`, `lint` and `format` do what they
say. Each runs its own generation step, so `pnpm run generate` is only ever a
recovery command.

## Connecting to the shell

Start the shell, run this in its browser console, and reload.

```js
const key = 'company:mfe:overrides'
const overrides = JSON.parse(localStorage.getItem(key) || '{}')
overrides['canvas-01'] = 'http://localhost:3101/mf-manifest.json'
localStorage.setItem(key, JSON.stringify(overrides))
location.reload()
```

Deleting just your id resets it; unrelated overrides are kept. A change needs a
reload, not a remount: the container's modules are already registered and its
chunks are document-level. The override is a URL only, never a token.

## Configuration

`src/mfe.config.ts` holds the schema and the environment mapping — no values
and no secrets. The values live in `public/runtime-config.json`: the dev server
publishes `public/` next to this container's assets (`server.publicDir` in
`rsbuild.config.ts`), which is where the generated loader fetches it from. Put
your local values there. A deployment publishes its own file beside its assets,
so no value is ever built into the container.

Read configuration with `import { config } from '#mfe/config'` and make
authenticated requests with `import { fetch } from '#mfe/fetch'`; the token is
attached only to origins declared `{ api: true }`, and request code never
handles one.
