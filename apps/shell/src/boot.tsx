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
import {
  createBrowserNavigationBridge,
  createNoopTelemetryProvider,
  createSpanEmitter,
  installShellAuth,
  type TelemetryProvider,
} from '@company/mfe-host'
import { loadRemote, registerRemotes } from '@module-federation/runtime'
import { toast } from 'sonner'

import { createFaroProvider } from './shell/faro.ts'
import { preferredTheme } from './shell/preferences.ts'
import { createShellRouter } from './shell/router.tsx'
import { createDevSession } from './shell/session.ts'
import { sessionGeneration } from './shell/session-generation.ts'
import { notices } from './shell/workspace.ts'
import './styles/app.css'

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

/**
 * Faro when a collector is configured, a provider that keeps nothing otherwise.
 * Deliberately not the recording provider: that one is a test double, and a
 * shell with no collector would fill its bounded buffers for the life of the
 * page with records nobody ever drains. The span implementation is the
 * framework's either way — a provider says what to do with a finished span, it
 * never writes a second Tracer.
 */
function telemetryProvider(): TelemetryProvider {
  const url = process.env['FARO_URL']
  if (typeof url !== 'string' || url === '') return createNoopTelemetryProvider()

  return createFaroProvider(url, (attribution, onSpanEnd) =>
    createSpanEmitter(attribution, { onSpanEnd }),
  )
}

const container = document.getElementById('root')
if (!container) throw new Error('index.html must contain <div id="root">')

// Before any remote is registered: a container's generated #mfe/fetch resolves
// this at its first request, and one session for the page is what keeps refresh
// single-flight across every mount.
installShellAuth({
  tokens: createDevSession(),
  isDevelopment: process.env['NODE_ENV'] !== 'production',
})

const storage = overrideStorage()

/**
 * The signed-in user. Declared before the runtime because the session
 * generation is derived from it: a shell that boots with somebody in force owes
 * the framework the generation that session's storage is fenced by, and without
 * it every `retention: 'user'` write is refused.
 */
const user = { id: 'u-2841', name: 'Robin Kolesnik', email: 'robin.kolesnik@example.com' }

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
    user,
    groups: ['geoscience', 'well-planning.read'],
    // The choice this browser last made, or the operating system's. The same
    // function decides it in the inline script in index.html, so the document
    // never paints in one theme and then switches to the other.
    theme: preferredTheme(),
  },
  // The Faro adapter is the real path; this test shell has no collector to send
  // to, so it records unless one is configured. Both satisfy the same seam,
  // which is the point of the seam.
  telemetryProvider: telemetryProvider(),
  navigationBridge: createBrowserNavigationBridge(),
  // Stable across a reload, fresh for a new tab — the same lifetime as the
  // session-retained data it fences.
  sessionGeneration: sessionGeneration(user.id),
  ...(storage === undefined ? {} : { overrideStorage: storage }),
  notifyCommandDenial: notice => toast.warning(notice.label, { description: notice.reason }),
})

notices.overrides = activeOverrides

// Built once. Creating it inside the JSX below would hand RouterProvider a new
// router on every render, and TanStack re-initialises a router it has not seen
// — which remounts everything under the boundary on every pass.
const router = createShellRouter()

// Hot reload re-executes this module, and a second createRoot on the same
// container orphans the first.
declare global {
  var shellRoot: ReturnType<typeof createRoot> | undefined
}
globalThis.shellRoot ??= createRoot(container)

globalThis.shellRoot.render(
  <StrictMode>
    <MfeProvider runtime={runtime}>
      <RouterProvider router={router} />
    </MfeProvider>
  </StrictMode>,
)
