/**
 * Command registration scoped by where it is injected: a command belongs to its mount, or to the
 * host page outside one. A factory is re-run by an effect, so a decision that reads signals is
 * republished when they change, and the registry publishes nothing when the visible result did not.
 *
 * A `shortcut` travels with the registration: the host reads every key once and runs the command
 * through the palette's path, while this mount's App is where the page is. A Widget's is ignored.
 */

import { assertInInjectionContext, DestroyRef, effect, inject, untracked } from '@angular/core'
import type { CommandRegistration, Decision } from '@company/mfe-core'

import { injectMfeRuntime, injectOptionalMfeMount } from './runtime.ts'

/**
 * `canExecute`, answering its first call with a decision already taken. The registry evaluates a
 * registration as it updates the entry, outside the effect's reactive context, so the effect takes
 * the decision itself, tracked, and hands it over for that one evaluation rather than asking twice
 * per change. Every later call, such as the one `execute` makes, asks afresh.
 */
function answeredOnce(decision: Decision, canExecute: () => Decision): () => Decision {
  let answered = false
  return () => {
    if (answered) return canExecute()
    answered = true
    return decision
  }
}

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
    const { canExecute } = next
    const decided =
      canExecute === undefined
        ? next
        : { ...next, canExecute: answeredOnce(canExecute(), canExecute) }
    untracked(() => {
      handle.update(decided)
    })
  })
}
