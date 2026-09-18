/**
 * Command registration as a hook, so mount scoping falls out of component
 * lifetime instead of being a rule the author has to remember. There is no
 * registry object to acquire and no disposer to return.
 *
 * Two effects, deliberately: the first owns the registration's existence, the
 * second publishes the latest committed callbacks. Splitting them is what lets
 * inline `execute` and `canExecute` closures stay current without removing and
 * recreating the registration on every render.
 *
 * Nothing is published during render. An abandoned render must not reach the
 * palette, so every write happens after React commits.
 */

import { useEffect, useRef } from 'react'
import type { CommandRegistration } from '@company/mfe-core'
import type { CommandRegistrationHandle } from '@company/mfe-host'

import { useMfeMount } from '../mount-context.tsx'

export function useCommand(registration: CommandRegistration): void {
  const mount = useMfeMount('useCommand')
  const handle = useRef<CommandRegistrationHandle | null>(null)

  // Holds the newest committed registration so the registration effect can pick
  // it up on re-registration (for example after a Strict Mode remount) without
  // depending on render-time values.
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
