/**
 * The shell chrome: the header and the notice strip under it, and nothing of the shell's own
 * below them. Every export here is a component, so React Refresh can replace it in place (§18).
 */

import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { useBlocker, useNavigate } from '@tanstack/react-router'
import {
  useApps,
  useBreadcrumbs,
  useMfeRuntime,
  useTheme,
  useUser,
  type BreadcrumbItem,
  type RegistryEntry,
} from '@company/mfe-react'
import {
  boundaryDefinitionId,
  createNavigationIntent,
  parseBoundaryLocation,
} from '@company/mfe-react/host'
import { MfeDevtools } from '@company/mfe-devtools'
import {
  Breadcrumb,
  BreadcrumbItem as Crumb,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
} from '@tecton/react/components/breadcrumb'
import { Button } from '@tecton/react/components/button'
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@tecton/react/components/dropdown-menu'
import { Toaster } from '@tecton/react/components/sonner'
import { RouterProvider as AriaRouterProvider } from 'react-aria-components'
import {
  AppFinder,
  AppFinderGroup,
  AppFinderInput,
  AppFinderItem,
  AppFinderList,
  AppFinderMenu,
  AppFinderTrigger,
} from '@tecton/react/tecton/app-finder'
import {
  AppShell,
  AppShellAction,
  AppShellActions,
  AppShellBody,
  AppShellCommandTrigger,
  AppShellDivider,
  AppShellHeader,
  AppShellMain,
  AppShellNav,
  AppShellOverflow,
  AppShellUserMenu,
} from '@tecton/react/tecton/app-shell'
import {
  BugIcon,
  CircleHelpIcon,
  ClipboardCopyIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MoonIcon,
  SettingsIcon,
  SparklesIcon,
  SunIcon,
} from 'lucide-react'
import { toast } from 'sonner'

import { shellSession } from '../auth/gate.ts'

import { collectDiagnostics, formatReport } from './diagnostics.ts'
import { HelpSheet } from './help-sheet.tsx'
import {
  useActiveApp,
  useAnnounceShellNavigation,
  useActionShortcuts,
  useShellActions,
  useShellSurface,
} from './hooks.ts'
import { CommandPalette } from './palette.tsx'
import { writeTheme } from './preferences.ts'
import { ReleasesDialog } from './releases-dialog.tsx'
import { ReportBugDialog } from './report-bug-dialog.tsx'
import { SettingsSheet } from './settings-sheet.tsx'
import { shellUi } from './ui-store.ts'
import { workspace } from './workspace.ts'

/** Declared once at module scope, so every surface is handed the same function rather than a new closure per render. */
const closeOnDismiss = (open: boolean): void => {
  if (!open) shellUi.close()
}

/** The shell's own page, which the finder lists beside the applications. */
const DASHBOARD = {
  id: '@dashboard',
  icon: 'DSH',
  tone: 'violet',
  name: 'Widget dashboard',
} as const

/**
 * Derived rather than stored twice, so the list and the trigger cannot disagree. An id the
 * registry does not know still gets a tile, because the boundary below is already saying it
 * could not be loaded.
 */
function appFace(
  id: string,
  entry: RegistryEntry | undefined,
): { readonly icon: string; readonly tone: 'blue' | 'saffron'; readonly name: string } {
  return {
    // The finder's tile draws a short text mark; a parsed icon is data it has no slot for, so an
    // entry carrying one still falls back to its initials here until the tile learns to draw one.
    icon: typeof entry?.icon === 'string' ? entry.icon : id.slice(0, 3).toUpperCase(),
    tone: entry?.overridden === true ? 'saffron' : 'blue',
    name: entry?.title ?? id,
  }
}

export function ShellLayout({ children }: { readonly children: ReactNode }): ReactNode {
  const runtime = useMfeRuntime('the shell layout')
  const navigate = useNavigate()
  const surface = useShellSurface()
  // Shell state is the theme's one source of truth, so a mounted App reads the same value
  // through the same hook.
  const theme = useTheme()
  useAnnounceShellNavigation()
  // The shell's own actions and their keys, and the one listener every action's keys go
  // through — a mounted App's included, which renders in a React root of its own.
  useShellActions()
  useActionShortcuts()

  useEffect(() => {
    // `dark` is what the design system's variant keys off.
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.documentElement.style.colorScheme = theme
    // Remembered here rather than at each switch, because the theme has four ways to change and
    // a fifth added later would be the one that forgets; the key is the bare `theme` (§24).
    writeTheme(theme)
  }, [theme])

  // `action` is forwarded rather than dropped, because refusing the back button while allowing a
  // redirect is a distinction an App is entitled to make.
  useBlocker({
    shouldBlockFn: async ({ current, next, action }) => {
      const outcome = await runtime.navigator.requestNavigation(
        createNavigationIntent(
          parseBoundaryLocation(current.pathname),
          parseBoundaryLocation(next.pathname),
          // Derived the same way the chrome derives it, so the two cannot disagree about which
          // App this negotiates with.
          `/${boundaryDefinitionId(current.pathname) ?? ''}`,
          action,
        ),
        // The router commits when this resolves false, so there is nothing to commit here.
        () => {},
      )
      return outcome === 'blocked'
    },
    // Asked of the blockers rather than counted, so an App that says `enableBeforeUnload: false`
    // is not overruled by the shell.
    enableBeforeUnload: () => runtime.navigator.wantsUnloadPrompt(),
  })

  return (
    <>
      {/* A third child of this grid would land in the `1fr` row and push the mounted App down the page. */}
      <AppShell>
        {/* A React Aria link with an `href` is a document navigation unless a router is provided, and every breadcrumb click tore the shell down. */}
        <AriaRouterProvider navigate={to => void navigate({ to })}>
          <Header />
        </AriaRouterProvider>
        <AppShellBody className="flex-col">
          <AppShellMain className="flex">{children}</AppShellMain>
        </AppShellBody>
      </AppShell>

      {/* Every shell surface is mounted here and opened from the store, so none needs to know where another lives. */}
      <CommandPalette open={surface === 'palette'} onOpenChange={closeOnDismiss} />
      <SettingsSheet isOpen={surface === 'settings'} onOpenChange={closeOnDismiss} />
      <HelpSheet isOpen={surface === 'help'} onOpenChange={closeOnDismiss} />
      <ReleasesDialog isOpen={surface === 'releases'} onOpenChange={closeOnDismiss} />
      <ReportBugDialog isOpen={surface === 'bug'} onOpenChange={closeOnDismiss} />
      {/* Not a member of `ShellSurface`: the developer tools own their open state and are not modal (§22). */}
      <MfeDevtools />
      {/* Explicit: the Toaster otherwise reads next-themes and falls back to the system preference. */}
      <Toaster position="bottom-right" theme={theme} />
    </>
  )
}

/** With sign-in off there is nothing to sign out of, and the menu says so rather than hiding it (§36). */
function SignOutItem(): ReactNode {
  const session = shellSession()

  if (session.mode === 'disabled') {
    return (
      <DropdownMenuItem textValue="Sign-in is off" isDisabled>
        <LogOutIcon /> Sign-in is off
      </DropdownMenuItem>
    )
  }

  return (
    <DropdownMenuItem
      textValue="Sign out"
      onAction={() => {
        session.signOut().catch(() => {
          toast.error('Sign-out did not complete.', {
            description: 'The identity provider could not be reached. Try again in a moment.',
          })
        })
      }}
    >
      <LogOutIcon /> Sign out
    </DropdownMenuItem>
  )
}

function Header(): ReactNode {
  const runtime = useMfeRuntime('the shell header')
  const navigate = useNavigate()
  const apps = useApps()
  const active = useActiveApp()
  const theme = useTheme()
  // Subscribed rather than read off the store: a bare `getUser()` is a snapshot nothing re-runs.
  const user = useUser()

  const current = active === null ? DASHBOARD : appFace(active.id, active.entry)

  const initials = (user?.name ?? '?')
    .split(/\s+/)
    .map(part => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <AppShellHeader data-slot="shell-header" className="gap-1 sm:gap-2">
      <AppFinder>
        {/* The application you are in, not the workspace: the workspace name is already the first breadcrumb. */}
        <AppFinderTrigger name={current.name} tone={current.tone}>
          {current.icon}
        </AppFinderTrigger>
        <AppFinderMenu>
          <AppFinderInput />
          <AppFinderList
            onAction={key => {
              const id = String(key)
              void (id === '@dashboard'
                ? navigate({ to: '/' })
                : navigate({ to: '/$appId', params: { appId: id } }))
            }}
          >
            <AppFinderGroup heading="Shell">
              <AppFinderItem
                id={DASHBOARD.id}
                icon={DASHBOARD.icon}
                tone={DASHBOARD.tone}
                name={DASHBOARD.name}
                description="Compose a page from registered Widgets"
                keywords={['dashboard', 'widgets']}
              />
            </AppFinderGroup>
            <AppFinderGroup heading="Applications">
              {apps.map(app => (
                <AppFinderItem
                  key={app.id}
                  id={app.id}
                  {...appFace(app.id, app)}
                  description={app.manifestUrl}
                  keywords={[app.id]}
                />
              ))}
            </AppFinderGroup>
          </AppFinderList>
        </AppFinderMenu>
      </AppFinder>

      <AppShellDivider className="hidden sm:block" />

      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Widget dashboard"
        className="hidden sm:inline-flex"
        onPress={() => {
          void navigate({ to: '/' })
        }}
      >
        <LayoutDashboardIcon />
      </Button>

      <AppShellNav className="overflow-hidden">
        <Breadcrumbs />
      </AppShellNav>

      {/* Below `lg` these move into the overflow menu rather than disappearing, because a button absent at one width is a feature the user cannot find. */}
      <AppShellActions>
        <AppShellCommandTrigger
          onPress={() => {
            shellUi.show('palette')
          }}
        >
          Search or jump to…
        </AppShellCommandTrigger>
        <AppShellAction
          label="Help"
          shortcut="?"
          onPress={() => {
            shellUi.show('help')
          }}
        >
          <CircleHelpIcon />
        </AppShellAction>
        <AppShellAction
          label="What’s new"
          className="hidden lg:inline-flex"
          onPress={() => {
            shellUi.show('releases')
          }}
        >
          <SparklesIcon />
        </AppShellAction>
        <AppShellAction
          label="Report a bug"
          className="hidden lg:inline-flex"
          onPress={() => {
            shellUi.show('bug')
          }}
        >
          <BugIcon />
        </AppShellAction>
        <AppShellAction
          label="Settings"
          shortcut="g s"
          className="hidden lg:inline-flex"
          onPress={() => {
            shellUi.show('settings')
          }}
        >
          <SettingsIcon />
        </AppShellAction>

        <AppShellOverflow label="More" className="lg:hidden">
          <DropdownMenuGroup>
            <DropdownMenuItem
              textValue="What's new"
              onAction={() => {
                shellUi.show('releases')
              }}
            >
              <SparklesIcon /> What’s new
            </DropdownMenuItem>
            <DropdownMenuItem
              textValue="Report a bug"
              onAction={() => {
                shellUi.show('bug')
              }}
            >
              <BugIcon /> Report a bug
            </DropdownMenuItem>
            <DropdownMenuItem
              textValue="Settings"
              onAction={() => {
                shellUi.show('settings')
              }}
            >
              <SettingsIcon /> Settings
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </AppShellOverflow>

        <AppShellUserMenu user={{ name: user?.name ?? 'Unknown', initials }}>
          <DropdownMenuGroup>
            <DropdownMenuItem
              textValue="Switch theme"
              onAction={() => {
                runtime.shellState.apply({ theme: theme === 'dark' ? 'light' : 'dark' })
              }}
            >
              {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
              {theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            </DropdownMenuItem>
            <DropdownMenuItem
              textValue="Settings"
              onAction={() => {
                shellUi.show('settings')
              }}
            >
              <SettingsIcon /> Settings
            </DropdownMenuItem>
            <DropdownMenuItem
              textValue="Help and keyboard shortcuts"
              onAction={() => {
                shellUi.show('help')
              }}
            >
              <CircleHelpIcon /> Help and keyboard shortcuts
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              textValue="Copy diagnostics"
              onAction={() => {
                const report = formatReport(
                  'Shell diagnostics',
                  'Copied from the account menu.',
                  collectDiagnostics(runtime),
                )
                void navigator.clipboard
                  .writeText(report)
                  .then(() => {
                    toast.success('Diagnostics copied to the clipboard.')
                  })
                  .catch(() => {
                    toast.error('This browser would not give the page the clipboard.')
                  })
              }}
            >
              <ClipboardCopyIcon /> Copy diagnostics
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <SignOutItem />
          </DropdownMenuGroup>
        </AppShellUserMenu>
      </AppShellActions>
    </AppShellHeader>
  )
}

/** The trail comes from `runtime.breadcrumbs`, never from router state here: the shell publishes its own portion through the hook a mounted App uses (§26). */
function Breadcrumbs(): ReactNode {
  const runtime = useMfeRuntime('the shell breadcrumbs')
  const active = useActiveApp()

  const items = useMemo(() => {
    const trail: BreadcrumbItem[] = [{ key: 'workspace', label: workspace.name, href: '/' }]

    // The same answer the finder's trigger shows, from the same hook, so a crumb never
    // contradicts the boundary below it.
    if (active === null) trail.push({ key: 'dashboard', label: DASHBOARD.name })
    else {
      trail.push({
        key: active.id,
        label: appFace(active.id, active.entry).name,
        ...(active.entry === undefined ? {} : { href: `/${active.id}` }),
      })
    }

    return trail
  }, [active])

  useBreadcrumbs(items)

  const trail = useSyncExternalStore(
    runtime.breadcrumbs.subscribe,
    runtime.breadcrumbs.getSnapshot,
    runtime.breadcrumbs.getSnapshot,
  )

  return (
    <Breadcrumb>
      <BreadcrumbList className="flex-nowrap">
        {trail.map((item, index) =>
          index === trail.length - 1 || item.href === undefined ? (
            <Crumb key={item.key} className="min-w-0">
              <BreadcrumbPage>{item.label}</BreadcrumbPage>
            </Crumb>
          ) : (
            <Crumb key={item.key} className="hidden md:inline-flex">
              <BreadcrumbLink href={item.href}>{item.label}</BreadcrumbLink>
            </Crumb>
          ),
        )}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
