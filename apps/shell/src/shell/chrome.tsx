/**
 * The shell chrome: the header, and the notice strip under it. Below those two
 * rows the shell renders nothing of its own — no padding, no card, no page
 * title. The mounted App gets the region and chooses its own layout.
 *
 * Every export here is a component. That is not tidiness: React Refresh only
 * replaces a module in place when it can prove every export is a component, and
 * one exported hook beside them turns every edit to this file into a full page
 * reload. The hooks live in `hooks.ts` and the boot facts in `workspace.ts`.
 */

import { useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { useBlocker, useNavigate } from '@tanstack/react-router'
import {
  useMfeRuntime,
  type BreadcrumbItem,
  type MfeRuntime,
  type NeutralRegistryEntry,
} from '@company/mfe-react'
import { createNavigationIntent, parseBoundaryLocation } from '@company/mfe-host'
import { devtools, MfeDevtools } from '@company/mfe-devtools'
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
  AppShellBody,
  AppShellHeader,
  AppShellMain,
  AppShellNav,
} from '@tecton/react/tecton/app-shell'
import {
  ShellAction,
  ShellActions,
  ShellCommandTrigger,
  ShellDivider,
  ShellOverflow,
  ShellUserMenu,
} from '@tecton/react/tecton/shell-actions'
import { ShortcutsProvider, useShortcut } from '@tecton/react/tecton/shortcuts'
import {
  BugIcon,
  CircleHelpIcon,
  ClipboardCopyIcon,
  LayoutDashboardIcon,
  MoonIcon,
  SettingsIcon,
  SparklesIcon,
  SunIcon,
} from 'lucide-react'
import { toast } from 'sonner'

import { collectDiagnostics, formatReport } from './diagnostics.ts'
import { HelpSheet } from './help-sheet.tsx'
import { useActiveApp, useApps, useShellSurface, useTheme } from './hooks.ts'
import { CommandPalette } from './palette.tsx'
import { writeTheme } from './preferences.ts'
import { ReleasesDialog } from './releases-dialog.tsx'
import { ReportBugDialog } from './report-bug-dialog.tsx'
import { SettingsSheet } from './settings-sheet.tsx'
import { shellUi } from './ui-store.ts'
import { workspace } from './workspace.ts'

/**
 * Every surface dismisses to the page underneath it. Declared once at module
 * scope so each one is handed the same function rather than a new closure per
 * render — and so none of them needs to know which surface it is.
 */
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
 * How one application looks in the finder — the same tile, tone and name
 * whether it is being offered in the list or shown in the trigger as the
 * current one. Derived rather than stored twice, so the two cannot disagree
 * about what you are looking at.
 *
 * An id the registry does not know still gets a tile: the boundary below is
 * already saying it could not be loaded, and a trigger reading "Widget
 * dashboard" over that error would be the shell lying about where you are.
 */
function appFace(
  id: string,
  entry: NeutralRegistryEntry | undefined,
): { readonly icon: string; readonly tone: 'blue' | 'saffron'; readonly name: string } {
  return {
    icon: entry?.icon ?? id.slice(0, 3).toUpperCase(),
    tone: entry?.overridden === true ? 'saffron' : 'blue',
    name: entry?.title ?? id,
  }
}

export function ShellLayout({ children }: { readonly children: ReactNode }): ReactNode {
  const runtime = useMfeRuntime('the shell layout')
  const navigate = useNavigate()
  const surface = useShellSurface()
  const theme = useTheme()

  useEffect(() => {
    // What the design system's `dark` variant keys off. MFEs observe the same
    // value through `useTheme()`, so the toggle is visible on both sides.
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.documentElement.style.colorScheme = theme
    // Remembered here rather than at each switch, because the theme has four
    // ways to change — the menu, settings, the palette, a shortcut — and a
    // fifth one added later would otherwise be the one that forgets.
    writeTheme(theme)
  }, [theme])

  /*
   * The shell's half of the navigation-blocking contract.
   *
   * A mount with unsaved edits is blocking through its own router's
   * `useBlocker`, and the framework registers that with the runtime's
   * navigator on its behalf; this is what makes the shell's own navigations go
   * past it. The router asks, the navigator negotiates with every affected
   * mount innermost first, and the mount renders its own confirmation — the
   * shell never draws that dialog and never decides the answer.
   *
   * `action` is forwarded rather than dropped: the App's `shouldBlockFn`
   * receives it, and refusing the back button while allowing a redirect is a
   * distinction an author is entitled to make.
   */
  useBlocker({
    shouldBlockFn: async ({ current, next, action }) => {
      const outcome = await runtime.navigator.requestNavigation(
        createNavigationIntent(
          parseBoundaryLocation(current.pathname),
          parseBoundaryLocation(next.pathname),
          // The boundary of whatever is mounted now: the first segment is the
          // App's id, and everything under it is that App's own.
          `/${current.pathname.split('/').filter(Boolean)[0] ?? ''}`,
          action,
        ),
        // The router commits for us when this resolves false, so there is
        // nothing to commit here — the negotiation's outcome is the answer.
        () => {},
      )
      return outcome === 'blocked'
    },
    // A reload or a closed tab is not a navigation the router sees, and it
    // discards the same edits. Asked of the blockers rather than counted, so an
    // App that says `enableBeforeUnload: false` is not overruled by the shell.
    enableBeforeUnload: () => runtime.navigator.wantsUnloadPrompt(),
  })

  return (
    // One registry for the page: the shell registers ⌘K here and a mounted App
    // registers its own shortcuts into the same one.
    <ShortcutsProvider>
      {/*
       * The shell's frame is two rows — header, then everything else — and the
       * notice strip goes inside the second one rather than becoming a third.
       * A third child of the grid lands in the `1fr` row and stretches to fill
       * it, which pushes the mounted App down the page by the height of the
       * region it should have had.
       */}
      <AppShell>
        {/*
         * The design system's links are React Aria links, and a React Aria link
         * with an `href` is a document navigation unless a router is provided
         * for it. Every breadcrumb click therefore tore the whole shell down
         * and re-fetched every container, to arrive at a route the router could
         * have reached without leaving the page.
         *
         * The provider is scoped to the chrome rather than to the document: a
         * mounted App owns the URL below its boundary, and a link inside it
         * belongs to its router, not to this one.
         */}
        <AriaRouterProvider navigate={to => void navigate({ to })}>
          <Header />
        </AriaRouterProvider>
        <AppShellBody className="flex-col">
          <AppShellMain className="flex">{children}</AppShellMain>
        </AppShellBody>
      </AppShell>

      {/*
       * Every shell surface is mounted here and opened from the store, so the
       * palette can open settings and settings can open the registry without
       * either one knowing where the other lives.
       */}
      <CommandPalette open={surface === 'palette'} onOpenChange={closeOnDismiss} />
      <SettingsSheet isOpen={surface === 'settings'} onOpenChange={closeOnDismiss} />
      <HelpSheet isOpen={surface === 'help'} onOpenChange={closeOnDismiss} />
      <ReleasesDialog isOpen={surface === 'releases'} onOpenChange={closeOnDismiss} />
      <ReportBugDialog isOpen={surface === 'bug'} onOpenChange={closeOnDismiss} />
      {/*
       * Passed explicitly: the design system's Toaster reads next-themes and
       * falls back to the system preference when there is no provider, which
       * the shell does not mount — its theme is shell state, applied above.
       */}
      {/*
       * The developer tools. Mounted unconditionally and gated at runtime: the
       * component reads its flag and renders nothing when it is off, and the
       * panel itself is a chunk that is only fetched once somebody has opted
       * in. Not a member of `ShellSurface` — it owns its own open state,
       * because the package cannot reach into the shell's store, and because
       * unlike the sheets it is not modal and does not close the others.
       */}
      <MfeDevtools />
      <Toaster position="bottom-right" theme={theme} />
    </ShortcutsProvider>
  )
}

function Header(): ReactNode {
  const runtime = useMfeRuntime('the shell header')
  const navigate = useNavigate()
  const apps = useApps()
  const active = useActiveApp()
  const theme = useTheme()
  const user = runtime.shellState.getUser()

  const current = active === null ? DASHBOARD : appFace(active.id, active.entry)

  useShortcut({
    id: 'shell.palette',
    keys: 'mod+k',
    label: 'Search or jump to…',
    group: 'Shell',
    onAction: () => {
      shellUi.toggle('palette')
    },
  })

  useShortcut({
    id: 'shell.help',
    keys: '?',
    label: 'Help and keyboard shortcuts',
    group: 'Shell',
    onAction: () => {
      shellUi.toggle('help')
    },
  })

  useShortcut({
    id: 'shell.registry',
    keys: 'g r',
    label: 'Open the registry',
    group: 'Shell',
    onAction: () => {
      devtools.open('registry')
    },
  })

  useShortcut({
    id: 'shell.devtools',
    keys: 'g d',
    label: 'Open the developer tools',
    group: 'Shell',
    onAction: () => {
      devtools.open('overrides')
    },
  })

  useShortcut({
    id: 'shell.settings',
    keys: 'g s',
    label: 'Open settings',
    group: 'Shell',
    onAction: () => {
      shellUi.toggle('settings')
    },
  })

  useShortcut({
    id: 'shell.dashboard',
    keys: 'g d',
    label: 'Go to the Widget dashboard',
    group: 'Shell',
    onAction: () => {
      void navigate({ to: '/' })
    },
  })

  useShortcut({
    id: 'shell.theme',
    keys: 'mod+j',
    label: 'Switch between light and dark',
    group: 'Shell',
    onAction: () => {
      runtime.shellState.apply({ theme: theme === 'dark' ? 'light' : 'dark' })
    },
  })

  const initials = (user?.name ?? '?')
    .split(/\s+/)
    .map(part => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <AppShellHeader data-slot="shell-header" className="gap-1 sm:gap-2">
      <AppFinder>
        {/*
         * The application you are in, not the workspace you are in. The
         * workspace name is already the first breadcrumb, and a trigger that
         * never changed made the one control that switches application look
         * like it had nothing to switch.
         */}
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

      <ShellDivider className="hidden sm:block" />

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

      {/*
       * Below `lg` the last three actions move into the overflow menu rather
       * than disappearing. A button that is hidden at one width and absent at
       * another is a feature the user cannot find; a menu is one more tap.
       */}
      <ShellActions>
        <ShellCommandTrigger
          onPress={() => {
            shellUi.show('palette')
          }}
        >
          Search or jump to…
        </ShellCommandTrigger>
        <ShellAction
          label="Help"
          shortcut="?"
          onPress={() => {
            shellUi.show('help')
          }}
        >
          <CircleHelpIcon />
        </ShellAction>
        <ShellAction
          label="What’s new"
          className="hidden lg:inline-flex"
          onPress={() => {
            shellUi.show('releases')
          }}
        >
          <SparklesIcon />
        </ShellAction>
        <ShellAction
          label="Report a bug"
          className="hidden lg:inline-flex"
          onPress={() => {
            shellUi.show('bug')
          }}
        >
          <BugIcon />
        </ShellAction>
        <ShellAction
          label="Settings"
          shortcut="g s"
          className="hidden lg:inline-flex"
          onPress={() => {
            shellUi.show('settings')
          }}
        >
          <SettingsIcon />
        </ShellAction>

        <ShellOverflow label="More" className="lg:hidden">
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
        </ShellOverflow>

        <ShellUserMenu user={{ name: user?.name ?? 'Unknown', initials }}>
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
        </ShellUserMenu>
      </ShellActions>
    </AppShellHeader>
  )
}

/**
 * The trail comes from `runtime.breadcrumbs`, never from router state here. The
 * shell publishes its own depth-0 portion (the workspace, and the App the
 * registry says is mounted at the active boundary); a mounted App contributes
 * at depth 1 and the store composes the two.
 */
function Breadcrumbs(): ReactNode {
  const runtime = useMfeRuntime('the shell breadcrumbs')
  const active = useActiveApp()
  const handle = useRef<ReturnType<MfeRuntime['breadcrumbs']['registerMount']> | null>(null)

  const items = useMemo(() => {
    const trail: BreadcrumbItem[] = [{ key: 'workspace', label: workspace.name, href: '/' }]

    // The same answer the finder's trigger shows, from the same hook: an id the
    // registry does not know still names itself, because the boundary below is
    // already saying it could not be loaded and a crumb reading "Widget
    // dashboard" over that error would be the shell lying about where you are.
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

  useEffect(() => {
    const registration = runtime.breadcrumbs.registerMount('shell', 'shell#0', 0)
    handle.current = registration
    return () => {
      handle.current = null
      registration.remove()
    }
  }, [runtime])

  useEffect(() => void handle.current?.update(items), [items])

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
