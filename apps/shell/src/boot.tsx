/**
 * Shell boot.
 *
 * Order is the point: the registry is fetched, then `createMfeRuntime` reads
 * the developer overrides and applies them to the manifest URLs *before* any
 * remote is registered. Registering first and overriding afterwards would mean
 * an overridden App still loaded from its deployed manifest once.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { createMf2ContainerLoader, createMfeRuntime, MfeProvider } from '@company/mfe-react'
import { createBrowserNavigationBridge, createRecordingTelemetryProvider } from '@company/mfe-host'
import { loadRemote, registerRemotes } from '@module-federation/runtime'
import { toast } from 'sonner'

import { createShellRouter } from './shell/router.tsx'
import './styles/app.css'

/** The workspace the shell represents, and the signed-in user, are shell facts. */
export const workspace = { code: 'DSG', name: 'Discovery' } as const

/**
 * Boot facts the chrome shows and the runtime does not carry. Decided once,
 * before anything is registered, so they are module state rather than a store.
 */
export const notices: { overrides: ReadonlyMap<string, string>; registryError: Error | null } = {
  overrides: new Map(),
  registryError: null,
}

/** A registry that will not load is a diagnostic, not a crash: the shell still boots. */
async function readRegistry(): Promise<readonly unknown[]> {
  try {
    const response = await fetch('/registry.json')
    if (!response.ok) throw new Error(`registry.json responded ${String(response.status)}`)
    const parsed: unknown = await response.json()
    if (!Array.isArray(parsed)) throw new Error('registry.json must contain an array')
    return parsed as readonly unknown[]
  } catch (cause) {
    notices.registryError = cause instanceof Error ? cause : new Error(String(cause))
    return []
  }
}

/** Reading `localStorage` throws outright when storage is blocked for the origin. */
function overrideStorage(): Pick<Storage, 'getItem'> | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

const container = document.getElementById('root')
if (!container) throw new Error('index.html must contain <div id="root">')

const storage = overrideStorage()
const { runtime, activeOverrides } = createMfeRuntime({
  registryEntries: await readRegistry(),
  // The only place in the shell that knows federation exists.
  loader: createMf2ContainerLoader({
    runtime: {
      registerRemotes: (remotes, options) => registerRemotes([...remotes], options),
      loadRemote: <T,>(id: string): Promise<T | null> => loadRemote<T>(id),
    },
  }),
  shellState: {
    user: { id: 'u-2841', name: 'Robin Kolesnik', email: 'robin.kolesnik@example.com' },
    groups: ['geoscience', 'well-planning.read'],
    theme: 'dark',
  },
  // A real deployment swaps this for the OTel or Faro adapter.
  telemetryProvider: createRecordingTelemetryProvider(),
  navigationBridge: createBrowserNavigationBridge(),
  ...(storage === undefined ? {} : { overrideStorage: storage }),
  notifyCommandDenial: notice => toast.warning(notice.label, { description: notice.reason }),
})

notices.overrides = activeOverrides

// Hot reload re-executes this module, and a second createRoot on the same
// container orphans the first.
declare global {
  var shellRoot: ReturnType<typeof createRoot> | undefined
}
globalThis.shellRoot ??= createRoot(container)

globalThis.shellRoot.render(
  <StrictMode>
    <MfeProvider runtime={runtime}>
      <RouterProvider router={createShellRouter(runtime)} />
    </MfeProvider>
  </StrictMode>,
)
