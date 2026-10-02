import {
  isMfeError,
  withoutUndefined,
  type Registry,
  type RuntimeSnapshot,
} from '@company/mfe-core'

import type { RuntimeMountStore } from '../mount/runtime-mount-store.ts'

/** Copy an allowlist rather than serializing live services or adapter-specific registry fields. */
export function readRuntimeSnapshot(
  apiVersion: string,
  registry: Registry,
  mounts: RuntimeMountStore,
): RuntimeSnapshot {
  return {
    apiVersion,
    capturedAt: Date.now(),
    mounts: mounts.read(),
    registry: {
      entries: [...registry.entries.values()].map(entry => ({
        id: entry.id,
        kind: entry.definitionKind,
        adapter: entry.adapter,
        ...withoutUndefined({ version: entry.version }),
        ...(entry.build === undefined
          ? {}
          : { build: withoutUndefined({ hash: entry.build.hash, time: entry.build.time }) }),
        overridden: entry.overridden === true,
      })),
      rejected: registry.rejected.map(entry => ({
        id: entry.id,
        reason: entry.reason,
        ...(isMfeError(entry.error) ? { errorCode: entry.error.code } : {}),
      })),
    },
  }
}
