/**
 * The theme shortcut, registered apart from the other shell actions because it saves the user's
 * preference and is only available once that preference has loaded.
 */

import { useEffect, useRef, type ReactNode } from 'react'
import { useMfeRuntime, useStoredState, useTheme } from '@company/mfe-react'
import type { ActionRegistrationHandle } from '@company/mfe-react/host'
import { toast } from 'sonner'

import { themeKey } from '../storage.ts'
import type { ShellTheme } from './preferences.ts'
import { themeAction } from './shell-actions.ts'

export function ThemeAction(): ReactNode {
  const runtime = useMfeRuntime('the theme shortcut')
  // Re-renders with the key's status, which follows the load.
  const stored = useStoredState(themeKey)
  // Writes before the user's values have loaded are refused, so the shortcut waits for them.
  const save =
    runtime.storage.user?.phase !== 'ready'
      ? undefined
      : async (theme: ShellTheme): Promise<void> => {
          try {
            await stored.set(theme)
          } catch (error) {
            // A save cut short by a sign-in is the previous user's, not a failure to report.
            if ((error as { code?: string }).code !== 'storage/disposed')
              toast.error('Your theme was not saved. Please try again.')
            throw error
          }
        }
  return <RegisterThemeAction save={save} />
}

function RegisterThemeAction({
  save,
}: {
  readonly save: ((theme: ShellTheme) => Promise<void>) | undefined
}): null {
  const runtime = useMfeRuntime('the theme shortcut')
  const theme = useTheme()
  const registration = themeAction(theme, save)
  const latest = useRef(registration)
  const registered = useRef<ActionRegistrationHandle | null>(null)
  useEffect(() => {
    const handle = runtime.actions.registerHost(latest.current)
    registered.current = handle
    return () => {
      registered.current = null
      handle.remove()
    }
  }, [runtime])
  useEffect(() => {
    latest.current = registration
    registered.current?.update(registration)
  })
  return null
}
