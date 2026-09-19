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

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useMatches, useNavigate } from '@tanstack/react-router'
import { useMfeRuntime, type BreadcrumbItem, type MfeRuntime } from '@company/mfe-react'
import {
  Breadcrumb,
  BreadcrumbItem as Crumb,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
} from '@tecton/react/components/breadcrumb'
import { Button } from '@tecton/react/components/button'
import { DropdownMenuGroup, DropdownMenuItem } from '@tecton/react/components/dropdown-menu'
import { Toaster } from '@tecton/react/components/sonner'
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
  ShellUserMenu,
} from '@tecton/react/tecton/shell-actions'
import { ShortcutsProvider, useShortcut } from '@tecton/react/tecton/shortcuts'
import {
  BugIcon,
  CircleHelpIcon,
  LayoutDashboardIcon,
  LayersIcon,
  MoonIcon,
  SettingsIcon,
  SparklesIcon,
  SunIcon,
} from 'lucide-react'

import { useApps, useTheme } from './hooks.ts'
import { CommandPalette } from './palette.tsx'
import { RegistryNotice, RegistrySheet } from './registry-sheet.tsx'
import { workspace } from './workspace.ts'

export function ShellLayout({ children }: { readonly children: ReactNode }): ReactNode {
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [registryOpen, setRegistryOpen] = useState(false)
  const theme = useTheme()

  useEffect(() => {
    // What the design system's `dark` variant keys off. MFEs observe the same
    // value through `useTheme()`, so the toggle is visible on both sides.
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.documentElement.style.colorScheme = theme
  }, [theme])

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
        <Header
          onOpenPalette={() => {
            setPaletteOpen(true)
          }}
          onOpenRegistry={() => {
            setRegistryOpen(true)
          }}
        />
        <AppShellBody className="flex-col">
          <RegistryNotice
            onOpen={() => {
              setRegistryOpen(true)
            }}
          />
          <AppShellMain className="flex">{children}</AppShellMain>
        </AppShellBody>
      </AppShell>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onOpenRegistry={() => {
          setRegistryOpen(true)
        }}
      />
      <RegistrySheet isOpen={registryOpen} onOpenChange={setRegistryOpen} />
      <Toaster position="bottom-right" />
    </ShortcutsProvider>
  )
}

function Header({
  onOpenPalette,
  onOpenRegistry,
}: {
  readonly onOpenPalette: () => void
  readonly onOpenRegistry: () => void
}): ReactNode {
  const runtime = useMfeRuntime('the shell header')
  const navigate = useNavigate()
  const apps = useApps()
  const theme = useTheme()
  const user = runtime.shellState.getUser()

  useShortcut({
    id: 'shell.palette',
    keys: 'mod+k',
    label: 'Search or jump to…',
    group: 'Shell',
    onAction: onOpenPalette,
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
        <AppFinderTrigger name={workspace.name} tone="blue">
          {workspace.code}
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
                id="@dashboard"
                icon="DSH"
                tone="violet"
                name="Widget dashboard"
                description="Compose a page from registered Widgets"
                keywords={['dashboard', 'widgets']}
              />
            </AppFinderGroup>
            <AppFinderGroup heading="Applications">
              {apps.map(app => (
                <AppFinderItem
                  key={app.id}
                  id={app.id}
                  icon={app.icon ?? app.id.slice(0, 3).toUpperCase()}
                  tone={app.overridden === true ? 'saffron' : 'blue'}
                  name={app.title ?? app.id}
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

      <ShellActions>
        <ShellCommandTrigger onPress={onOpenPalette}>Search or jump to…</ShellCommandTrigger>
        <ShellAction label="Registry" onPress={onOpenRegistry}>
          <LayersIcon />
        </ShellAction>
        <ShellAction label="Help">
          <CircleHelpIcon />
        </ShellAction>
        <ShellAction label="What's new" className="hidden lg:inline-flex">
          <SparklesIcon />
        </ShellAction>
        <ShellAction label="Report a bug" className="hidden lg:inline-flex">
          <BugIcon />
        </ShellAction>
        <ShellAction label="Settings" className="hidden lg:inline-flex">
          <SettingsIcon />
        </ShellAction>
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
  const matches = useMatches()
  const apps = useApps()
  const handle = useRef<ReturnType<MfeRuntime['breadcrumbs']['registerMount']> | null>(null)

  const appId = matches
    .map(match => (match.params as { appId?: string }).appId)
    .find(id => typeof id === 'string' && id !== '')
  const entry = apps.find(app => app.id === appId)

  const items = useMemo(() => {
    const trail: BreadcrumbItem[] = [{ key: 'workspace', label: workspace.name, href: '/' }]

    if (entry) trail.push({ key: entry.id, label: entry.title ?? entry.id, href: `/${entry.id}` })
    // An id in the URL that the registry does not know is still that id. The
    // boundary below is already saying it could not be loaded, and a crumb
    // reading "Widget dashboard" over that error would be the shell lying about
    // where you are.
    else if (appId !== undefined) trail.push({ key: appId, label: appId })
    else trail.push({ key: 'dashboard', label: 'Widget dashboard' })

    return trail
  }, [entry, appId])

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
