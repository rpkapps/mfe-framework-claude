/**
 * Agent context scoped by where it is injected: a selection belongs to its mount, or to the host
 * page outside one, and goes when the injector is destroyed or the mount is disposed. A factory is
 * re-run by an effect, so a selection that reads signals is republished when they change, and the
 * store publishes nothing when the parsed value did not.
 */

import { assertInInjectionContext, DestroyRef, effect, inject, untracked } from '@angular/core'
import type { AgentContextRegistration, AgentPrompt } from '@company/mfe-core'
import type { z } from 'zod'

import { injectMfeRuntime, injectOptionalMfeMount } from './runtime.ts'

/**
 * Publishes a small, typed snapshot of what is selected or focused, sent with each of the agent's
 * turns: ids and a short label, never whole records and never secrets.
 */
export function injectAgentContext<Schema extends z.ZodType>(
  registration: AgentContextRegistration<Schema> | (() => AgentContextRegistration<Schema>),
): void {
  assertInInjectionContext(injectAgentContext)

  const mount = injectOptionalMfeMount()
  const { agentContext } = injectMfeRuntime('injectAgentContext()')

  const initial = typeof registration === 'function' ? untracked(registration) : registration
  const handle =
    mount === null ? agentContext.registerHost(initial) : agentContext.register(mount, initial)

  inject(DestroyRef).onDestroy(() => {
    handle.remove()
  })

  if (typeof registration !== 'function') return

  const factory = registration
  effect(() => {
    const next = factory()
    untracked(() => {
      handle.update(next)
    })
  })
}

/**
 * Returns a function that hands a prompt to the shell's chat, so a click becomes a chat turn. It
 * returns whether a chat took it; `false` means there is none, or the prompt was refused.
 */
export function injectAgentPrompt(): (prompt: AgentPrompt) => boolean {
  assertInInjectionContext(injectAgentPrompt)

  const mount = injectOptionalMfeMount()
  const { agentContext } = injectMfeRuntime('injectAgentPrompt()')

  return prompt =>
    mount === null ? agentContext.prompt(prompt) : agentContext.prompt(prompt, mount.definitionId)
}
