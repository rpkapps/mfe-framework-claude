/** Behind their own entry point because none of these fakes belongs in a browser bundle. */

export { createInProcessLoader } from './in-process-loader.ts'

export {
  createMemoryHostRuntime,
  type MemoryHostRuntime,
  type MemoryHostRuntimeOptions,
} from './memory-host-runtime.ts'

export { createMemoryNavigationBridge } from './memory-navigation-bridge.ts'

export { createMemoryStorageArea, type MemoryStorageArea } from './memory-storage-area.ts'

export {
  createRecordingTelemetryProvider,
  type RecordingProviderOptions,
  type RecordingTelemetryProvider,
} from './recording-provider.ts'
