/**
 * The shell chrome: the header, and the notice strip under it. Below those two
 * rows the shell renders nothing of its own — no padding, no card, no page
 * title. The mounted App gets the region and chooses its own layout.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { useMatches, useNavigate } from '@tanstack/react-router'
import { useMfeRuntime, type BreadcrumbItem, type MfeRuntime } from '@company/mfe-react'
import {
  Breadcrumb,
  BreadcrumbItem as Crumb,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
} from '@tecton/react/components/breadcrumb'
import { Badge } from '@tecton/react/components/badge'
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
  FlaskConicalIcon,
  HomeIcon,
  MoonIcon,
  SettingsIcon,
  SparklesIcon,
  SunIcon,
  TriangleAlertIcon,
} from 'lucide-react'

import { notices, workspace } from '../boot.tsx'
import { CommandPalette } from './palette.tsx'

/** Registered Apps, in registry order. Widgets own no URL; hidden ones opt out. */
export function useApps() {
  const runtime = useMfeRuntime('the shell app finder')
  return useMemo(
    () =>
      [...runtime.registry.entries.values()].filter(
        entry => entry.definitionKind === 'app' && entry.hidden !== true,
      ),
    [runtime],
  )
}

export function useTheme(): 'light' | 'dark' {
  const runtime = useMfeRuntime('the shell theme')
  const subscribe = useCallback(
    (listener: () => void) => runtime.shellState.subscribeToField('theme', listener),
    [runtime],
  )
  return useSyncExternalStore(subscribe, runtime.shellState.getTheme, runtime.shellState.getTheme)
}

export function ShellLayout({ children }: { readonly children: ReactNode }): ReactNode {
  const [paletteOpen, setPaletteOpen] = useState(false)
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
      {/* Three rows, not the shell's default two: header, notices, App. */}
      <AppShell className="grid-rows-[auto_auto_1fr]">
        <Header onOpenPalette={() => setPaletteOpen(true)} />
        <Notices />
        <AppShellBody>
          <AppShellMain className="flex">{children}</AppShellMain>
        </AppShellBody>
      </AppShell>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <Toaster position="bottom-right" />
    </ShortcutsProvider>
  )
}

function Header({ onOpenPalette }: { readonly onOpenPalette: () => void }) {
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
    <AppShellHeader data-slot="shell-header" className="gap-1 px-2 sm:gap-2">
      <AppFinder>
        <AppFinderTrigger name={workspace.name} tone="blue">
          {workspace.code}
        </AppFinderTrigger>
        <AppFinderMenu>
          <AppFinderInput />
          <AppFinderList
            onAction={key => void navigate({ to: '/$appId', params: { appId: String(key) } })}
          >
            <AppFinderGroup heading="Applications">
              {apps.map(app => (
                <AppFinderItem
                  key={app.id}
                  id={app.id}
                  icon={app.icon ?? app.id.slice(0, 3).toUpperCase()}
                  tone={app.overridden ? 'saffron' : 'blue'}
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
        aria-label="Home"
        className="hidden sm:inline-flex"
        onPress={() => void navigate({ to: '/' })}
      >
        <HomeIcon />
      </Button>

      <AppShellNav className="overflow-hidden">
        <Breadcrumbs />
      </AppShellNav>

      <ShellActions>
        <ShellCommandTrigger onPress={onOpenPalette}>Search or jump to…</ShellCommandTrigger>
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
              onAction={() =>
                runtime.shellState.apply({ theme: theme === 'dark' ? 'light' : 'dark' })
              }
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
function Breadcrumbs() {
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
    return trail
  }, [entry])

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
              <BreadcrumbPage className="truncate">{item.label}</BreadcrumbPage>
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

/**
 * Overrides and rejected registry entries, where they cannot be missed. A
 * forgotten override pointing at a dead dev server is the phantom bug the
 * override mechanism exists to prevent, so it is named with the snippet that
 * clears it. Renders nothing when there is nothing to report.
 */
function Notices() {
  const { quarantined } = useMfeRuntime('the shell notices').registry
  const { overrides, registryError } = notices
  if (overrides.size === 0 && quarantined.length === 0 && !registryError) return null

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-border-subtle px-3 py-1.5 text-xs">
      {overrides.size > 0 ? (
        <span className="flex flex-wrap items-center gap-1.5 text-warning-surface-foreground">
          <FlaskConicalIcon className="size-3.5" />
          <span className="font-medium">Developer overrides active:</span>
          {[...overrides].map(([id, url]) => (
            <Badge key={id} variant="warning" size="md">
              {id} → {url}
            </Badge>
          ))}
          <code className="font-mono opacity-70">
            localStorage.removeItem(&apos;company:mfe:overrides&apos;)
          </code>
        </span>
      ) : null}

      {registryError ? (
        <span className="text-destructive">registry.json: {registryError.message}</span>
      ) : null}

      {quarantined.length > 0 ? (
        <span className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
          <TriangleAlertIcon className="size-3.5" />
          <span className="font-medium">
            {quarantined.length} registry entr{quarantined.length === 1 ? 'y' : 'ies'} quarantined:
          </span>
          {quarantined.map(entry => (
            <Badge key={entry.id} variant="destructive" size="md" title={entry.error.message}>
              {entry.id} — {entry.reason}
            </Badge>
          ))}
        </span>
      ) : null}
    </div>
  )
}
