/**
 * The App starter. It writes the router bootstrap and the module augmentation
 * for the author, because those are the two pieces that are easy to get subtly
 * wrong and tedious to debug: a router built with the wrong base path renders
 * at the wrong boundary, and a missing augmentation degrades every route's types.
 */

import {
  overrideSnippet,
  packageJsonFile,
  sharedFiles,
  type TemplateFile,
  type TemplateOptions,
} from './types.ts'

export function appTemplate(options: TemplateOptions): readonly TemplateFile[] {
  const { id, packageName } = options

  return [
    ...sharedFiles(),

    packageJsonFile(options, 3101, {
      dependencies: { '@tanstack/react-query': 'catalog:', '@tanstack/react-router': 'catalog:' },
    }),

    {
      path: 'src/mfe.ts',
      contents: `import { createApp, type AppRouterOptions } from '@company/mfe-react'
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
    capability: 'settings',
    label: '${id} settings',
    icon: 'settings',
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
  await environment?.dispose()
  environment = null
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

An MFE App. Its id is \`${id}\`.

## Commands

\`\`\`sh
pnpm install
pnpm run dev        # starts the remote and prints its manifest URL
pnpm run build
pnpm run typecheck
pnpm test
pnpm run generate   # the one recovery command when generated output is stale
\`\`\`

Dev, test, typecheck and build run their own generation steps, so ordinary edits
never need \`generate\` by hand.

## Connecting to the shell

There is no standalone harness: you develop against the real shell with a real
session, so no class of authentication bug waits until deployment. Start the
shell, run this in its browser console, and reload.

${overrideSnippet(id, 3101)}

## Configuration

\`src/mfe.config.ts\` holds the schema and the environment mapping — no values
and no secrets. Copy \`runtime-config.example.json\` to your local values path.
Read configuration with \`import { config } from '#mfe/config'\` and make
authenticated requests with \`import { fetch } from '#mfe/fetch'\`. The token is
attached only to origins declared \`{ api: true }\`, and request code never
handles one.
`,
    },
  ]
}
