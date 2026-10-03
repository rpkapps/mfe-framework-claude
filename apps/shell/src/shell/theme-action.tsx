import { Component, Suspense, useEffect, useRef, type ReactNode } from 'react'
import { useMfeRuntime, useTheme, useUser } from '@company/mfe-react'
import type { ActionRegistrationHandle } from '@company/mfe-react/host'
import { useUserContext } from '#mfe/user-context'
import { toast } from 'sonner'
import { themeAction } from './shell-actions.ts'
import type { ShellTheme } from './preferences.ts'

/** Preference hydration never suspends the shell or its other keyboard shortcuts. */
export function ThemeAction(): ReactNode {
  return (
    <UserPreferences pending={<RegisterThemeAction />} failed={<RegisterThemeAction />}>
      <SavedThemeAction />
    </UserPreferences>
  )
}

/** Hydrates the signed-in user's preferences with its own Suspense and error boundaries. */
export function UserPreferences({
  pending,
  failed,
  children,
}: {
  readonly pending: ReactNode
  readonly failed: ReactNode
  readonly children: ReactNode
}): ReactNode {
  const user = useUser()
  // Keyed by identity, so a sign-in after a failed load hydrates again.
  return (
    <PreferenceBoundary
      key={JSON.stringify([user?.tenantId, user?.accountId, user?.id])}
      failed={failed}
    >
      <Suspense fallback={pending}>{children}</Suspense>
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

class PreferenceBoundary extends Component<
  { readonly failed: ReactNode; readonly children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }
  override render(): ReactNode {
    return this.state.failed ? this.props.failed : this.props.children
  }
}
