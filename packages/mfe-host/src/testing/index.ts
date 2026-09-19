/**
 * `@company/mfe-host/testing` — the fakes a test drives the host with.
 *
 * They live behind their own entry point because every one of them is a full
 * implementation of a production seam (a store, a bridge, a loader, a telemetry
 * provider) and none of them belongs in a browser bundle. A separate subpath is
 * what makes that structural rather than a tree-shaking hope.
 */

export { createInProcessLoader } from './in-process-loader.ts'

export { createMemoryNavigationBridge } from './memory-navigation-bridge.ts'

export { createMemoryStorageArea, type MemoryStorageArea } from './memory-storage-area.ts'

export {
  createRecordingTelemetryProvider,
  type RecordingProviderOptions,
  type RecordingTelemetryProvider,
} from './recording-provider.ts'
