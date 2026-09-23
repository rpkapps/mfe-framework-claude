/**
 * Shell boot: the registry is fetched first, so `createMfeRuntime` applies the developer
 * overrides to the manifest URLs before any remote is registered. The diagnostics hub is built
 * before the runtime, because `installShellAuth` runs before a runtime exists to report into (§25).
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { angularAdapter } from '@company/mfe-angular/registry'
import { legacyAngularAdapter } from '@company/mfe-legacy-angular'
import {
  createBrowserNavigationBridge,
  createFederationContainerLoader,
  createMfeRuntime,
  createNoopTelemetryProvider,
  createSpanEmitter,
  DiagnosticsHub,
  installShellAuth,
  MfeProvider,
  telemetryDiagnosticsSink,
  type TelemetryProvider,
} from '@company/mfe-react/host'
import { reactAdapter } from '@company/mfe-react/registry'
import { loadRemote, registerRemotes } from '@module-federation/runtime'
import { toast } from 'sonner'

import { createFaroProvider } from './shell/faro.ts'
import { preferredTheme } from './shell/preferences.ts'
import { createShellRouter } from './shell/router.tsx'
import { createDevSession } from './shell/session.ts'
import { notices } from './shell/workspace.ts'
import './styles/app.css'

/** A registry that will not load is a diagnostic, not a crash: the shell still boots. */
async function fetchRegistryEntries(): Promise<readonly unknown[]> {
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

/** Deliberately not the recording provider: with no collector it would fill its bounded buffers for the life of the page. */
function telemetryProvider(): TelemetryProvider {
  const url = process.env['FARO_URL']
  if (typeof url !== 'string' || url === '') return createNoopTelemetryProvider()

  return createFaroProvider(url, (attribution, onSpanEnd) =>
    createSpanEmitter(attribution, { onSpanEnd }),
  )
}

const container = document.getElementById('root')
if (!container) throw new Error('index.html must contain <div id="root">')

const telemetry = telemetryProvider()
const diagnostics = new DiagnosticsHub([telemetryDiagnosticsSink(telemetry)])

// Before any remote is registered: one session for the page keeps refresh single-flight across
// every mount, and a container's generated #mfe/fetch resolves it at its first request (§10).
installShellAuth({
  tokens: createDevSession(),
  diagnostics,
  isDevelopment: process.env['NODE_ENV'] !== 'production',
})

const overrideSource = overrideStorage()

const { runtime, activeOverrides } = createMfeRuntime({
  registryEntries: await fetchRegistryEntries(),
  // Every framework this shell serves, each listed: nothing is registered implicitly, and no
  // entry is read by an adapter it does not name.
  adapters: [reactAdapter, angularAdapter, legacyAngularAdapter],
  // The only place in the shell that knows federation exists.
  loader: createFederationContainerLoader({
    runtime: {
      registerRemotes: (remotes, options) => registerRemotes([...remotes], options),
      loadRemote: <T,>(id: string): Promise<T | null> => loadRemote<T>(id),
    },
  }),
  shellState: {
    user: { id: 'u-2841', name: 'Robin Kolesnik', email: 'robin.kolesnik@example.com' },
    groups: ['geoscience', 'well-planning.read'],
    // Decided the same way the pre-paint script in index.html decided it, so shell state agrees
    // with what the document is already painting.
    theme: preferredTheme(),
  },
  telemetryProvider: telemetry,
  navigationBridge: createBrowserNavigationBridge(),
  diagnostics,
  ...(overrideSource === undefined ? {} : { overrideStorage: overrideSource }),
  notifyCommandDenial: notice => toast.warning(notice.label, { description: notice.reason }),
})

notices.overrides = activeOverrides

// Built once, because TanStack re-initialises a router it has not seen and remounts everything
// under the boundary with it.
const router = createShellRouter()

// Hot reload re-executes this module, and a second createRoot on the same container orphans the first.
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
