/**
 * The React adapter's runtime and mounts: the host's neutral runtime with `reactAdapter` always
 * registered, and the host's mount context with the Query client a React tree is rendered with.
 */

import type { MfeAdapter } from '@company/mfe-core'
import {
  createHostRuntime,
  createMountContext,
  type CreateHostRuntimeOptions,
  type CreateMountContextOptions,
  type HostRuntimeHandle,
} from '@company/mfe-runtime'
import { QueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { reactAdapter } from './registry/react-adapter.ts'
import type { MfeMount } from './runtime.ts'

export interface CreateRuntimeOptions extends Omit<CreateHostRuntimeOptions, 'adapters'> {
  /**
   * Adapters besides `reactAdapter`, which is always registered. Order means nothing: exactly
   * one adapter must recognise an entry, so an entry a framework build published can never be
   * read by another adapter because one of its fields was malformed. It is rejected instead.
   */
  readonly adapters?: readonly MfeAdapter[]
}

export type MfeRuntimeHandle = HostRuntimeHandle

export function createMfeRuntime(options: CreateRuntimeOptions): MfeRuntimeHandle {
  return createHostRuntime({ ...options, adapters: [reactAdapter, ...(options.adapters ?? [])] })
}

export type CreateMountOptions = CreateMountContextOptions

export interface MountHandleWithCleanup {
  readonly mount: MfeMount
  /** Tears down everything this mount owns; the ordering is deliberate. */
  dispose(): Promise<void>
}

/** Every mount gets its own Query client, so a child never inherits a parent's cache. */
export function createMount(options: CreateMountOptions): MountHandleWithCleanup {
  const handle = createMountContext(options)
  const { context } = handle
  const queryClient = new QueryClient()

  // The context aborts after removing the mount's registrations and before closing its
  // telemetry, which is where the Query client goes. Signalled, not waited on: teardown must
  // not block on in-flight requests.
  context.signal.addEventListener(
    'abort',
    () => {
      void queryClient.cancelQueries()
      queryClient.clear()
    },
    { once: true },
  )

  return { mount: { ...context, queryClient }, dispose: () => handle.dispose() }
}

/**
 * The mount this component owns, created and destroyed by the same effect, because a mount
 * built in `useMemo` does not survive the remount StrictMode performs (§14).
 */
export function useOwnedMount(
  create: () => MountHandleWithCleanup,
  deps: readonly unknown[],
): MfeMount | null {
  const [handle, setHandle] = useState<MountHandleWithCleanup | null>(null)

  useEffect(
    () => {
      const created = create()

      // The rule is right about the general case and this is the exception it
      // names: an effect that connects to an external system has to publish the
      // thing it connected to. Creating the mount during render instead is what
      // React actually forbids — it appends an overlay root to the document,
      // starts a tracer and allocates a Query client, none of which belong in a
      // render React may discard.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
      setHandle(created)

      return () => {
        void created.dispose()
      }
    },
    // `create` is called by the effect and is rebuilt on every render by every
    // call site, so it is deliberately not a dependency; `deps` names what the
    // mount is actually derived from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps,
  )

  return handle?.mount ?? null
}
