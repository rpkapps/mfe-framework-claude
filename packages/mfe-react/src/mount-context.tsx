/**
 * The internal React context carrying a mount's identity and services; there is no generic
 * `useMfeContext` because one accessor would make every consumer subscribe to everything.
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

/** The common cause of a miss is a shell-rendered component, so the message says so. */
export function useMfeMount(hookName: string): MfeMount {
  const mount = useContext(MountContext)
  if (mount) return mount

  throw createMfeError({
    code: 'mount/failure',
    id: '<unmounted>',
    operation: `call ${hookName}`,
    expected: 'a component rendered inside an App or Widget mount',
    observed: 'a component rendered outside any mount',
    repair: `Move the ${hookName} call into a component the App or Widget renders.`,
  })
}

/** Returns the mount when there is one, without throwing. */
export function useOptionalMfeMount(): MfeMount | null {
  return useContext(MountContext)
}
