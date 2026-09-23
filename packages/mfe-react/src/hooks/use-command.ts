/**
 * Command registration as a hook, so scoping falls out of component lifetime: a command belongs
 * to its mount, or to the host page outside one (§26). Two effects, deliberately: one owns the
 * registration, the other publishes the latest callbacks, so inline closures stay current.
 *
 * A `shortcut` travels with the registration: the host reads every key once and runs the command
 * through the palette's path, while this mount's App is where the page is. A Widget's is ignored.
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

  // Keyed by what identifies the owner rather than by the context object, so a provider that
  // hands down a fresh object with the same mount does not re-register.
  const definitionId = mount?.definitionId
  const mountToken = mount?.mountToken
  const kind = mount?.kind
  const basePath = mount?.basePath

  useEffect(() => {
    const registered =
      definitionId === undefined ||
      mountToken === undefined ||
      kind === undefined ||
      basePath === undefined
        ? commands.registerHost(committed.current)
        : commands.register({ definitionId, mountToken, kind, basePath }, committed.current)
    handle.current = registered

    return () => {
      handle.current = null
      registered.remove()
    }
  }, [commands, definitionId, mountToken, kind, basePath])

  // The registry compares the visible result and publishes nothing when only identity changed.
  useEffect(() => {
    committed.current = registration
    handle.current?.update(registration)
  })
}
