/**
 * Reaching the runtime and the mount from an injection context. A mount knows its runtime, so
 * code inside one never depends on the host having provided it; shell chrome outside every mount
 * reaches the same runtime through `provideMfeRuntime` and resolves to the host scope.
 */

import { assertInInjectionContext, inject } from '@angular/core'
import { createMfeError } from '@company/mfe-core'
import type { MfeRuntime, MountContext } from '@company/mfe-runtime'

import { MFE_MOUNT, MFE_RUNTIME } from './tokens.ts'

export function injectMfeRuntime(consumer = 'injectMfeRuntime()'): MfeRuntime {
  assertInInjectionContext(injectMfeRuntime)

  const mount = inject(MFE_MOUNT, { optional: true })
  if (mount) return mount.runtime

  const runtime = inject(MFE_RUNTIME, { optional: true })
  if (runtime) return runtime

  throw createMfeError({
    code: 'mount/failure',
    id: '<no-runtime>',
    operation: `call ${consumer}`,
    expected: 'provideMfeRuntime(runtime) in the application providers, or an enclosing mount',
    observed: 'neither',
    repair: "Add provideMfeRuntime(runtime) to the host application's providers once at boot.",
  })
}

/** The common cause of a miss is a host-rendered component, so the message says so. */
export function injectMfeMount(consumer = 'injectMfeMount()'): MountContext {
  assertInInjectionContext(injectMfeMount)

  const mount = inject(MFE_MOUNT, { optional: true })
  if (mount) return mount

  throw createMfeError({
    code: 'mount/failure',
    id: '<unmounted>',
    operation: `call ${consumer}`,
    expected: 'a component or service created inside an App or Widget mount',
    observed: 'one created outside any mount',
    repair: `Move the ${consumer} call into a component the App or Widget renders.`,
  })
}

/** The mount when there is one, without throwing; being outside one is a legal position. */
export function injectOptionalMfeMount(): MountContext | null {
  assertInInjectionContext(injectOptionalMfeMount)
  return inject(MFE_MOUNT, { optional: true })
}
