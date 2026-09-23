/**
 * Command registration scoped by where it is injected: a command belongs to its mount, or to the
 * host page outside one. A factory is re-run by an effect, so a decision that reads signals is
 * republished when they change, and the registry publishes nothing when the visible result did not.
 *
 * A `shortcut` travels with the registration: the host reads every key once and runs the command
 * through the palette's path, while this mount's App is where the page is. A Widget's is ignored.
 */

import { assertInInjectionContext, DestroyRef, effect, inject, untracked } from '@angular/core'
import type { CommandRegistration } from '@company/mfe-core'

import { injectMfeRuntime, injectOptionalMfeMount } from './runtime.ts'

export function injectCommand(
  registration: CommandRegistration | (() => CommandRegistration),
): void {
  assertInInjectionContext(injectCommand)

  const mount = injectOptionalMfeMount()
  const { commands } = injectMfeRuntime('injectCommand()')

  const initial = typeof registration === 'function' ? untracked(registration) : registration
  const handle = mount === null ? commands.registerHost(initial) : commands.register(mount, initial)

  inject(DestroyRef).onDestroy(() => {
    handle.remove()
  })

  if (typeof registration !== 'function') return

  const factory = registration
  effect(() => {
    const next = factory()
    // Called once here only to track the signals the decision reads; the registry evaluates it.
    next.canExecute?.()
    untracked(() => {
      handle.update(next)
    })
  })
}
