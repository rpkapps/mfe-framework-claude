/** Behind their own entry point because none of these fakes belongs in a browser bundle. */

import { resetMfeConfig } from './generated/config.ts'
import { resetMfeFetch } from './generated/fetch.ts'

export { createInProcessLoader } from './in-process-loader.ts'

export {
  createMemoryRuntime,
  type MemoryRuntime,
  type MemoryRuntimeOptions,
} from './memory-runtime.ts'

export { createMemoryNavigationBridge } from './memory-navigation-bridge.ts'

export { createMemoryStorageArea, type MemoryStorageArea } from './memory-storage-area.ts'

export {
  createRecordingTelemetryProvider,
  type RecordingProviderOptions,
  type RecordingTelemetryProvider,
} from './recording-provider.ts'

/**
 * The generated-alias fixtures, which a container's vitest config points `#mfe/config` and
 * `#mfe/fetch` at through its adapter's `/testing/mfe-config` and `/testing/mfe-fetch`. The source
 * under test keeps its production imports; nothing here is a second configuration API.
 */
export { resetMfeConfig, setMfeConfig } from './generated/config.ts'
export {
  mfeRequests,
  resetMfeFetch,
  setMfeAccessToken,
  setMfeApiBaseUrl,
  setMfeApiOrigins,
  setMfeFetch,
  type MfeFetchHandler,
  type MfeFetchRecord,
} from './generated/fetch.ts'

/** Everything the aliases hold, cleared; each adapter's shared vitest setup calls it. */
export function resetGeneratedAliases(): void {
  resetMfeConfig()
  resetMfeFetch()
}
