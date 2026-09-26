/**
 * Writes the App starter's router bootstrap and module augmentation: a wrong base path renders
 * at the wrong boundary, and a missing augmentation degrades every route's types.
 */

import {
  json,
  overrideSection,
  packageJsonFile,
  sharedFiles,
  type TemplateFile,
  type TemplateOptions,
} from './types.ts'

export function appTemplate(options: TemplateOptions): readonly TemplateFile[] {
  const { id, packageName } = options

  return [
    ...sharedFiles('./src/mfe.ts', options),

    packageJsonFile(options, 3101, {
      dependencies: { '@tanstack/react-query': 'catalog:', '@tanstack/react-router': 'catalog:' },
    }),

    // `src/mfe.config.ts` gives this App a config source, so the build generates
    // `#mfe/config`, which fetches runtime-config.json at boot; the dev server
    // answers it with this file. Without it, a scaffolded App fails at boot with
    // `config/missing`.
    {
      path: '.mfe/runtime-config.json',
      contents: json({ apiBaseUrl: 'https://api.example.test/v1/' }),
    },

    {
      path: 'src/mfe.ts',
      contents: `import { createApp, type AppRouterOptions, type MfeStaticData } from '@company/mfe-react'
import { createRouter } from '@tanstack/react-router'

import { routeTree } from './routeTree.gen'

// Called once per mount, not once per module. Pass basePath, history and
// context straight through; the framework validates that at mount.
function makeRouter({ basePath, history, context }: AppRouterOptions) {
  return createRouter({
    routeTree,
    basepath: basePath,
    history,
    context: { ...context },
    defaultPreload: 'intent',
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof makeRouter>
  }

  // The framework reads four fields off a route's staticData: the capability
  // pages the shell opens, and the breadcrumb label. Typing TanStack's own slot
  // with them makes a misspelt capability a compile error rather than a page
  // the shell never finds. An augmentation that adds no field of its own is how
  // one declared type is merged into another's slot; respelling MfeStaticData's
  // fields here is exactly the drift it avoids.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- see above.
  interface StaticDataRouteOption extends MfeStaticData {}
}

export default createApp({
  id: '${id}',
  version: '0.1.0',
  router: makeRouter,
})
`,
    },

    {
      path: 'src/mfe.config.ts',
      contents: `import { env } from '@company/mfe-rspack'
import { z } from 'zod'

// The schema and the environment mapping, with no deployment values and no
// secrets. Values marked { api: true } declare API origins, which is what lets
// the authenticated fetch attach a token to them and to nothing else.
export default {
  apiBaseUrl: env('API_BASE_URL', z.string().url(), { api: true }),
}
`,
    },

    {
      path: 'src/routes/__root.tsx',
      contents: `import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import type { MfeRouterContext } from '@company/mfe-react'

// A layout is a root route with an outlet, which is the native way to say it.
export const Route = createRootRouteWithContext<MfeRouterContext>()({
  component: () => <Outlet />,
})
`,
    },

    {
      path: 'src/routes/index.tsx',
      contents: `import { createFileRoute } from '@tanstack/react-router'
import { useUser } from '@company/mfe-react'

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  const user = useUser()

  return (
    <section>
      <h1>${id}</h1>
      <p>Signed in as {user?.name ?? 'nobody'}.</p>
    </section>
  )
}
`,
    },

    {
      path: 'src/routes/settings.tsx',
      contents: `import { createFileRoute } from '@tanstack/react-router'

// Settings, help and release notes are pages, so they are routes. Marking one
// is all an App does; the build extracts it into the manifest and the shell
// decides where it opens.
export const Route = createFileRoute('/settings')({
  staticData: {
    capability: {
      name: 'settings',
      label: '${id} settings',
      icon: 'settings',
    },
  },
  component: () => <h2>Settings</h2>,
})
`,
    },

    {
      path: 'src/routes/index.test.tsx',
      contents: `import { createMfeTestEnvironment } from '@company/mfe-react/testing'
import { renderHook } from '@testing-library/react'
import { useUser } from '@company/mfe-react'
import { afterEach, expect, it } from 'vitest'

// A component test with explicit fixtures: no shell process, no live
// credentials, no federation.
let environment: ReturnType<typeof createMfeTestEnvironment> | null = null

afterEach(async () => {
  // Cleared before the await, not after: a second test may have assigned a new
  // environment by the time this one resolves, and clearing then would drop it.
  const current = environment
  environment = null
  await current?.dispose()
})

it('reads the signed-in user from shell state', () => {
  environment = createMfeTestEnvironment({
    definitionId: '${id}',
    shellState: { user: { id: 'u-1', name: 'Ada Lovelace' } },
  })

  const { result } = renderHook(() => useUser(), { wrapper: environment.wrapper })

  expect(result.current?.name).toBe('Ada Lovelace')
})
`,
    },

    {
      path: 'README.md',
      contents: `# ${packageName}

An MFE App. Its id is \`${id}\`. \`pnpm run dev\` starts the remote and prints its
manifest URL; \`build\`, \`typecheck\`, \`test\`, \`lint\` and \`format\` do what they
say. Each runs its own generation step, so \`pnpm run generate\` is only ever a
recovery command.

${overrideSection(id, 3101)}

## Configuration

\`src/mfe.config.ts\` holds the schema and the environment mapping — no values
and no secrets. Your local values live in \`.mfe/runtime-config.json\`, the one
file in \`.mfe/\` that is committed. The dev server answers
\`runtime-config.json\` next to this container's assets with it, which is where
the generated loader fetches it from, and \`pnpm run generate\` adds any
declared default it lacks without changing a value you set. No build copies
\`.mfe/\`: a build ships the declared defaults, and a deployment publishes its
own file beside its assets, so no local value is ever built into the container.

If \`rsbuild.config.ts\` renames the file with
\`pluginMfe({ runtimeConfigFileName })\`, the dev server serves
\`.mfe/<that name>\` instead. \`pnpm run generate\` does not read
\`rsbuild.config.ts\`, so it neither seeds that file nor keeps it out of what
\`.mfe/.gitignore\` ignores: create it yourself and commit it once with
\`git add -f\`, after which git keeps tracking it.

Read configuration with \`import { config } from '#mfe/config'\` and make
authenticated requests with \`import { fetch } from '#mfe/fetch'\`; the token is
attached only to origins declared \`{ api: true }\`, and request code never
handles one.
`,
    },
  ]
}
