import { Component, Suspense, useEffect, useRef, type ReactNode } from 'react'
import { useMfeRuntime, useTheme, useUser } from '@company/mfe-react'
import type { ActionRegistrationHandle } from '@company/mfe-react/host'
import { useUserContext } from '#mfe/user-context'
import { toast } from 'sonner'
import { themeAction } from './shell-actions.ts'
import type { ShellTheme } from './preferences.ts'

/** Preference hydration never suspends the shell or its other keyboard shortcuts. */
export function ThemeAction(): ReactNode {
  const user = useUser()
  return (
    <PreferenceBoundary key={JSON.stringify([user?.tenantId, user?.accountId, user?.id])}>
      <Suspense fallback={<RegisterThemeAction />}>
        <SavedThemeAction />
      </Suspense>
    </PreferenceBoundary>
  )
}

function SavedThemeAction(): ReactNode {
  const [, set] = useUserContext(context => context.preferences.theme)
  return (
    <RegisterThemeAction
      save={async theme => {
        const result = await set('preferences', { theme })
        if (!result.ok) {
          if (result.error.code !== 'user-context/scope-disposed')
            toast.error('Your theme was not saved. Please try again.')
          throw result.error
        }
      }}
    />
  )
}

function RegisterThemeAction({
  save,
}: {
  readonly save?: (theme: ShellTheme) => Promise<void>
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

class PreferenceBoundary extends Component<{ readonly children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }
  override render(): ReactNode {
    return this.state.failed ? <RegisterThemeAction /> : this.props.children
  }
}
