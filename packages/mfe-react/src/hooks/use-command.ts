/**
 * Command registration as a hook, so scoping falls out of component lifetime:
 * no registry to acquire and no disposer to return.
 *
 * Inside a mount the command belongs to that mount and goes when it does;
 * outside one it belongs to the host page, in the reserved host scope. One
 * list, evaluated by one rule, whoever owns it.
 *
 * Two effects, deliberately: one owns the registration, the other publishes the
 * latest committed callbacks, so inline closures stay current without the
 * registration churning. Nothing is published during render.
 */

import { useEffect, useRef } from 'react'
import type { CommandRegistration } from '@company/mfe-core'
import type { CommandRegistrationHandle } from '@company/mfe-host'

import { useOptionalMfeMount } from '../mount-context.tsx'
import { useMfeRuntime } from '../runtime-context.tsx'

export function useCommand(registration: CommandRegistration): void {
  const mount = useOptionalMfeMount()
  const { commands } = useMfeRuntime('useCommand()')
  const handle = useRef<CommandRegistrationHandle | null>(null)

  // The newest committed registration, so re-registration (after a Strict Mode
  // remount, say) picks it up without depending on render-time values.
  const committed = useRef(registration)

  const definitionId = mount?.definitionId
  const mountToken = mount?.mountToken

  useEffect(() => {
    const registered =
      definitionId === undefined || mountToken === undefined
        ? commands.registerHost(committed.current)
        : commands.register(definitionId, mountToken, committed.current)
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
