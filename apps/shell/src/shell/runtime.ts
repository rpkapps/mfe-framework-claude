/**
 * Assembling the shell-side runtime.
 *
 * Boot order is the interesting part and it is not negotiable:
 *
 *  1. fetch the registry,
 *  2. hand `createMfeRuntime` the *raw* entries plus the override storage — it
 *     reads the overrides, applies them to the manifest URLs and quarantines
 *     whatever fails validation, all before a single remote is registered,
 *  3. only then does anything load.
 *
 * Registering a remote first and overriding it afterwards would mean the first
 * load of an overridden App still came from the deployed manifest, which is the
 * bug the override mechanism exists to prevent.
 */

import {
  createMf2ContainerLoader,
  createMfeRuntime,
  type MfeRuntimeHandle,
} from '@company/mfe-react'
import {
  createBrowserNavigationBridge,
  createRecordingTelemetryProvider,
  type CommandDenialNotifier,
} from '@company/mfe-host'
import { loadRemote, registerRemotes } from '@module-federation/runtime'

import { overrideStorage } from './override-storage.ts'
import { initialShellState } from './workspace.ts'

/** Where the shell reads its registry from. Served from `public/`. */
const REGISTRY_URL = '/registry.json'

/**
 * The shell's boot handle: the runtime plus the two things the chrome has to
 * show about how it was built.
 */
export interface ShellBoot {
  readonly handle: MfeRuntimeHandle
  /** Developer overrides that were applied, for the active-override indicator. */
  readonly activeOverrides: ReadonlyMap<string, string>
  /** Why the registry could not be fetched at all, if it could not. */
  readonly registryError: Error | null
}

/**
 * A registry that cannot be fetched is not a crash. The shell still boots, the
 * header still works, and the diagnostics surface says what happened — the same
 * treatment a single quarantined entry gets, one level up.
 */
async function fetchRegistryEntries(): Promise<{
  entries: readonly unknown[]
  error: Error | null
}> {
  try {
    const response = await fetch(REGISTRY_URL, { headers: { accept: 'application/json' } })
    if (!response.ok) {
      throw new Error(`${REGISTRY_URL} responded ${String(response.status)} ${response.statusText}`)
    }

    const parsed: unknown = await response.json()
    if (!Array.isArray(parsed)) {
      throw new Error(`${REGISTRY_URL} must contain an array of registry descriptors`)
    }

    return { entries: parsed, error: null }
  } catch (cause) {
    return {
      entries: [],
      error: cause instanceof Error ? cause : new Error(String(cause)),
    }
  }
}

export interface BootOptions {
  /** How a command denial reaches the user. Wired to the toast surface. */
  readonly notifyCommandDenial: CommandDenialNotifier
}

export async function bootShellRuntime(options: BootOptions): Promise<ShellBoot> {
  const { entries, error } = await fetchRegistryEntries()
  const storage = overrideStorage()

  const handle = createMfeRuntime({
    registryEntries: entries,

    // The federation runtime is injected rather than imported by the framework:
    // this is the only file in the shell that knows federation exists at all.
    loader: createMf2ContainerLoader({
      runtime: {
        registerRemotes: (remotes, registerOptions) =>
          registerRemotes([...remotes], registerOptions),
        loadRemote: <T,>(id: string): Promise<T | null> => loadRemote<T>(id),
      },
    }),

    shellState: initialShellState,

    // A real deployment swaps this for the OTel or Faro adapter. The recording
    // provider keeps the contract honest in the meantime: everything an MFE
    // emits is captured and nothing is silently dropped.
    telemetryProvider: createRecordingTelemetryProvider(),

    navigationBridge: createBrowserNavigationBridge(),

    // Read before any remote is registered. See the module comment.
    ...(storage === undefined ? {} : { overrideStorage: storage }),

    notifyCommandDenial: options.notifyCommandDenial,
  })

  return { handle, activeOverrides: handle.activeOverrides, registryError: error }
}
