/**
 * The shell-level runtime provider.
 *
 * A Widget can be consumed by the shell itself, so the runtime has to be
 * reachable without a surrounding mount. `MfeMountProvider` carries the
 * per-mount half.
 */

import { createContext, useContext, type ReactNode } from 'react'
import { createMfeError } from '@company/mfe-core'

import { useOptionalMfeMount } from './mount-context.tsx'
import type { MfeRuntime } from './runtime.ts'

const RuntimeContext = createContext<MfeRuntime | null>(null)

export interface MfeProviderProps {
  readonly runtime: MfeRuntime
  readonly children: ReactNode
}

export function MfeProvider({ runtime, children }: MfeProviderProps): ReactNode {
  return <RuntimeContext value={runtime}>{children}</RuntimeContext>
}

/**
 * A mount always knows its runtime, so it is consulted before the shell-level
 * provider: nested consumption then never depends on that provider existing.
 */
export function useMfeRuntime(consumer: string): MfeRuntime {
  const mount = useOptionalMfeMount()
  const runtime = useContext(RuntimeContext)

  if (mount) return mount.runtime
  if (runtime) return runtime

  throw createMfeError({
    code: 'mount/failure',
    id: '<no-runtime>',
    operation: `render ${consumer}`,
    expected: 'an MfeProvider above this component, or an enclosing App or Widget mount',
    observed: 'neither',
    repair: 'Wrap the shell in <MfeProvider runtime={runtime}> once at boot.',
  })
}
