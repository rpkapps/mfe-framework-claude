/**
 * Command registration as a hook, so scoping falls out of component lifetime: a command belongs
 * to its mount, or to the host page outside one (§26). Two effects, deliberately: one owns the
 * registration, the other publishes the latest callbacks, so inline closures stay current.
 */

import { useEffect, useRef } from 'react'
import type { CommandRegistration } from '@company/mfe-core'
import type { CommandRegistrationHandle } from '@company/mfe-runtime'

import { useOptionalMfeMount } from '../mount-context.tsx'
import { useMfeRuntime } from '../runtime-context.tsx'

export function useCommand(registration: CommandRegistration): void {
  const mount = useOptionalMfeMount()
  const { commands } = useMfeRuntime('useCommand()')
  const handle = useRef<CommandRegistrationHandle | null>(null)

  // The newest committed registration, so a re-registration picks it up after a remount.
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

  // The registry compares the visible result and publishes nothing when only identity changed.
  useEffect(() => {
    committed.current = registration
    handle.current?.update(registration)
  })
}
