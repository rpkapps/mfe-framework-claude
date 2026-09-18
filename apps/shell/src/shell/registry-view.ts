/**
 * Reading the normalized registry.
 *
 * The runtime normalizes and quarantines at boot, so the chrome never validates
 * anything: it lists what survived and reports what did not. The record types
 * are derived from the runtime rather than imported, because the package that
 * declares them is framework-internal.
 */

import { useMemo } from 'react'
import { useMfeRuntime, type MfeRuntime } from '@company/mfe-react'

/** A registry entry that passed validation. */
export type NeutralAppEntry = NonNullable<ReturnType<MfeRuntime['registry']['entries']['get']>>

/** An entry that failed validation. Reported, never silently dropped. */
export type QuarantinedEntry = MfeRuntime['registry']['quarantined'][number]

/**
 * Registered, visible Apps, in registry order.
 *
 * Widgets are excluded because they own no URL boundary, and `hidden` entries
 * because they are deliberately kept out of catalog and finder views. Neither
 * is a security boundary, and neither pretends to be.
 */
export function useAppEntries(): readonly NeutralAppEntry[] {
  const runtime = useMfeRuntime('the shell app finder')
  return useMemo(
    () =>
      [...runtime.registry.entries.values()].filter(
        entry => entry.definitionKind === 'app' && entry.hidden !== true,
      ),
    [runtime],
  )
}

export function useQuarantinedEntries(): readonly QuarantinedEntry[] {
  const runtime = useMfeRuntime('the shell diagnostics')
  return runtime.registry.quarantined
}
