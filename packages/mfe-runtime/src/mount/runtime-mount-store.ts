import type { RuntimeMountSnapshot } from '@company/mfe-core'

import { createMountToken } from './mount-context.ts'

/** Reads the mount controller's state on demand instead of maintaining a second lifecycle. */
export class RuntimeMountStore {
  readonly #mounts = new Map<string, () => Omit<RuntimeMountSnapshot, 'mountId'> | null>()
  #disposed = false

  /** @internal Called only by the neutral mount path; removal releases the controller reference. */
  track(
    definitionId: string,
    read: () => Omit<RuntimeMountSnapshot, 'mountId'> | null,
  ): () => void {
    if (this.#disposed) return () => undefined
    const mountId = createMountToken(definitionId)
    this.#mounts.set(mountId, read)
    return () => {
      this.#mounts.delete(mountId)
    }
  }

  read(): readonly RuntimeMountSnapshot[] {
    const snapshots: RuntimeMountSnapshot[] = []
    for (const [mountId, read] of this.#mounts) {
      const snapshot = read()
      if (snapshot !== null) snapshots.push({ mountId, ...snapshot })
    }
    return snapshots
  }

  dispose(): void {
    this.#disposed = true
    this.#mounts.clear()
  }
}
