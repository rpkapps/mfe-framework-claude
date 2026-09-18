/**
 * Command registration as a hook, so mount scoping falls out of component
 * lifetime: no registry to acquire and no disposer to return.
 *
 * Two effects, deliberately. The first owns the registration's existence, the
 * second publishes the latest committed callbacks, which is what lets inline
 * closures stay current without recreating the registration on every render.
 * Nothing is published during render: an abandoned render must not reach the
 * palette.
 */

import { useEffect, useRef } from 'react'
import type { CommandRegistration } from '@company/mfe-core'
import type { CommandRegistrationHandle } from '@company/mfe-host'

import { useMfeMount } from '../mount-context.tsx'

export function useCommand(registration: CommandRegistration): void {
  const mount = useMfeMount('useCommand')
  const handle = useRef<CommandRegistrationHandle | null>(null)

  // The newest committed registration, so re-registration (after a Strict Mode
  // remount, say) picks it up without depending on render-time values.
  const committed = useRef(registration)

  const { commands } = mount.runtime
  const { definitionId, mountToken } = mount

  useEffect(() => {
    const registered = commands.register(definitionId, mountToken, committed.current)
    handle.current = registered

    return () => {
      handle.current = null
      registered.remove()
    }
  }, [commands, definitionId, mountToken])

  // Runs after every commit. The registry compares the visible result and
  // publishes nothing when only closure identity changed.
  useEffect(() => {
    committed.current = registration
    handle.current?.update(registration)
  })
}
