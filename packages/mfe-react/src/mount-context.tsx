/**
 * The internal React context carrying a mount's identity and services.
 *
 * Authors never touch this. They reach the same services through the named
 * hooks, or through `context.mfe` in route callbacks, which is why there is no
 * generic `useMfeContext` in the public API: one generic accessor would make
 * every consumer subscribe to everything.
 */

import { createContext, useContext, type ReactNode } from 'react'
import { createMfeError } from '@company/mfe-core'

import type { MfeMount } from './runtime.ts'

const MountContext = createContext<MfeMount | null>(null)

export interface MfeMountProviderProps {
  readonly mount: MfeMount
  readonly children: ReactNode
}

export function MfeMountProvider({ mount, children }: MfeMountProviderProps): ReactNode {
  return <MountContext value={mount}>{children}</MountContext>
}

/**
 * Reads the current mount, failing with an actionable message when a hook is
 * called outside one. The common cause is a component rendered by the shell
 * rather than by an App or Widget, so the message says exactly that.
 */
export function useMfeMount(hookName: string): MfeMount {
  const mount = useContext(MountContext)
  if (mount) return mount

  throw createMfeError({
    code: 'mount/failure',
    id: '<unmounted>',
    operation: `call ${hookName}`,
    expected: 'a component rendered inside an App or Widget mount',
    observed: 'a component rendered outside any mount',
    declaredBy: 'The framework mount boundary',
    repair: `Move the ${hookName} call into a component the App or Widget renders. Shell-owned components use the shell's own APIs.`,
  })
}

/** Returns the mount when there is one, without throwing. Used by host components. */
export function useOptionalMfeMount(): MfeMount | null {
  return useContext(MountContext)
}
