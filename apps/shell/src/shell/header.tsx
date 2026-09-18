/**
 * The shell header.
 *
 * Everything in here is shell-owned chrome built from the design system's shell
 * primitives. Below it there is nothing: no padding, no card, no page title.
 * The mounted App gets the region and chooses its own layout, which is the
 * whole point of the boundary.
 */

import { useNavigate } from '@tanstack/react-router'
import { useMfeRuntime } from '@company/mfe-react'
import type { NeutralAppEntry } from './registry-view.ts'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
} from '@tecton/react/components/breadcrumb'
import { Button } from '@tecton/react/components/button'
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@tecton/react/components/dropdown-menu'
import {
  AppFinder,
  AppFinderGroup,
  AppFinderInput,
  AppFinderItem,
  AppFinderList,
  AppFinderMenu,
  AppFinderTrigger,
} from '@tecton/react/tecton/app-finder'
import { AppShellHeader, AppShellNav } from '@tecton/react/tecton/app-shell'
import {
  ShellAction,
  ShellActions,
  ShellCommandTrigger,
  ShellDivider,
  ShellUserMenu,
} from '@tecton/react/tecton/shell-actions'
import { useShortcut } from '@tecton/react/tecton/shortcuts'
import {
  BugIcon,
  CircleHelpIcon,
  HomeIcon,
  LogOutIcon,
  MoonIcon,
  SettingsIcon,
  SparklesIcon,
  SunIcon,
  UserIcon,
} from 'lucide-react'

import { useAppEntries } from './registry-view.ts'
import { useBreadcrumbTrail, useShellTheme, useShellUser } from './store-hooks.ts'
import { codeFor, initialsOf, toneFor, workspace } from './workspace.ts'

export interface ShellHeaderProps {
  readonly onOpenPalette: () => void
  readonly onOpenDiagnostics: () => void
  /** How many things the diagnostics surface has to report. */
  readonly diagnosticCount: number
}

export function ShellHeader({
  onOpenPalette,
  onOpenDiagnostics,
  diagnosticCount,
}: ShellHeaderProps) {
  const runtime = useMfeRuntime('the shell header')
  const navigate = useNavigate()
  const apps = useAppEntries()
  const trail = useBreadcrumbTrail()
  const theme = useShellTheme()
  const user = useShellUser()

  useShortcut({
    id: 'shell.palette',
    keys: 'mod+k',
    label: 'Search or jump to…',
    group: 'Shell',
    onAction: onOpenPalette,
  })

  const openApp = (entry: NeutralAppEntry): void => {
    void navigate({ to: '/$appId', params: { appId: entry.id } })
  }

  const toggleTheme = (): void => {
    // The MFEs observe this through `useTheme()`; the store notifies only the
    // subscribers of the field that actually changed.
    runtime.shellState.apply({ theme: theme === 'dark' ? 'light' : 'dark' })
  }

  return (
    <AppShellHeader data-slot="shell-header" className="gap-1 px-2 sm:gap-2">
      <AppFinder>
        <AppFinderTrigger
          name={workspace.name}
          tone={workspace.tone}
          aria-label={`Switch application, workspace: ${workspace.name}`}
        >
          {workspace.code}
        </AppFinderTrigger>
        <AppFinderMenu>
          <AppFinderInput />
          <AppFinderList
            onAction={key => {
              const entry = apps.find(app => app.id === String(key))
              if (entry) openApp(entry)
            }}
          >
            <AppFinderGroup heading="Applications">
              {apps.map(app => (
                <AppFinderItem
                  key={app.id}
                  id={app.id}
                  icon={codeFor(app.id, app.icon)}
                  tone={toneFor(app.id)}
                  name={app.title ?? app.id}
                  description={app.overridden ? `Overridden → ${app.manifestUrl}` : app.manifestUrl}
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
        <ShellBreadcrumbs trail={trail} />
      </AppShellNav>

      <ShellActions>
        <ShellCommandTrigger onPress={onOpenPalette}>Search or jump to…</ShellCommandTrigger>
        <ShellAction label="Help" shortcut="?" onPress={onOpenDiagnostics}>
          <CircleHelpIcon />
        </ShellAction>
        <ShellAction label="What's new" className="hidden lg:inline-flex">
          <SparklesIcon />
        </ShellAction>
        <ShellAction
          label={
            diagnosticCount > 0
              ? `Shell diagnostics (${String(diagnosticCount)})`
              : 'Shell diagnostics'
          }
          className="relative hidden lg:inline-flex"
          onPress={onOpenDiagnostics}
        >
          <BugIcon />
          {diagnosticCount > 0 ? (
            <span
              aria-hidden
              className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-destructive"
            />
          ) : null}
        </ShellAction>
        <ShellAction label="Settings" className="hidden lg:inline-flex">
          <SettingsIcon />
        </ShellAction>

        <ShellUserMenu user={{ name: user?.name ?? 'Unknown', initials: initialsOf(user?.name) }}>
          <DropdownMenuGroup>
            <DropdownMenuLabel className="font-normal">
              <div className="grid leading-tight">
                <span className="truncate font-medium text-foreground">
                  {user?.name ?? 'Not signed in'}
                </span>
                <span className="truncate text-xs">{user?.email ?? '—'}</span>
              </div>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem textValue="Profile">
              <UserIcon /> Profile
            </DropdownMenuItem>
            <DropdownMenuItem
              textValue="Switch theme"
              onAction={toggleTheme}
              // Named for what it does next, so the menu reads as an action.
            >
              {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
              {theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            </DropdownMenuItem>
            <DropdownMenuItem textValue="Shell diagnostics" onAction={onOpenDiagnostics}>
              <BugIcon /> Shell diagnostics
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem textValue="Sign out">
              <LogOutIcon /> Sign out
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </ShellUserMenu>
      </ShellActions>
    </AppShellHeader>
  )
}

/**
 * Renders the composed trail. The last item is the page the user is on, so it
 * is emphasised and not a link, whatever the contributor marked it.
 */
function ShellBreadcrumbs({
  trail,
}: {
  readonly trail: readonly { key: string; label: string; href?: string }[]
}) {
  if (trail.length === 0) return null

  return (
    <Breadcrumb>
      <BreadcrumbList className="flex-nowrap">
        {trail.map((item, index) => {
          const isLast = index === trail.length - 1
          return (
            <BreadcrumbItem
              key={item.key}
              className={isLast ? 'min-w-0' : 'hidden md:inline-flex'}
            >
              {isLast || item.href === undefined ? (
                <BreadcrumbPage className="truncate">{item.label}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink href={item.href}>{item.label}</BreadcrumbLink>
              )}
            </BreadcrumbItem>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
