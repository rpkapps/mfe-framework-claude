/**
 * The live shell-state signals, read through the runtime rather than a mount because none of them
 * uses a mount's identity, so shell chrome outside every mount reads the same values. Each
 * subscribes to one field, so a theme change cannot notify a consumer that only reads the user.
 */

import { assertInInjectionContext, type Signal } from '@angular/core'
import type { ShellTheme, ShellUser } from '@company/mfe-core'

import { signalFromStore } from '../signals.ts'
import { injectMfeRuntime } from './runtime.ts'

export function injectUser(): Signal<ShellUser | null> {
  assertInInjectionContext(injectUser)
  const { shellState } = injectMfeRuntime('injectUser()')
  return signalFromStore(
    listener => shellState.subscribeToField('user', listener),
    shellState.getUser,
  )
}

export function injectGroups(): Signal<readonly string[]> {
  assertInInjectionContext(injectGroups)
  const { shellState } = injectMfeRuntime('injectGroups()')
  return signalFromStore(
    listener => shellState.subscribeToField('groups', listener),
    shellState.getGroups,
  )
}

export function injectTheme(): Signal<ShellTheme> {
  assertInInjectionContext(injectTheme)
  const { shellState } = injectMfeRuntime('injectTheme()')
  return signalFromStore(
    listener => shellState.subscribeToField('theme', listener),
    shellState.getTheme,
  )
}
