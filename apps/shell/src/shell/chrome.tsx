/**
 * The shell chrome: the header and the notice strip under it, and nothing of the shell's own
 * below them. Every export here is a component, so React Refresh can replace it in place (§18).
 */

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from 'react'
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
import { MfeDevtools } from '@company/mfe-devtools'
import {
  Breadcrumb,
  BreadcrumbItem as Crumb,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@tecton/react/components/breadcrumb'
import { Button } from '@tecton/react/components/button'
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@tecton/react/components/dropdown-menu'
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
  AppShellAction,
  AppShellActions,
  AppShellBody,
  AppShellCommandTrigger,
  AppShellDivider,
  AppShellHeader,
  AppShellNav,
  AppShellOverflow,
  AppShellUserMenu,
} from '@tecton/react/tecton/app-shell'
import { Link } from '@tecton/react/tecton/link'
import { TectonProvider } from '@tecton/react/tecton/provider'
import {
  BotIcon,
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
import { useChatPanel, useShellChat } from '../chat/panel-hooks.ts'
import { ChatSheet, ChatSplit, ChatUnavailableSheet } from '../chat/lazy-panel.tsx'
import { ASSISTANT_BUTTON_ID } from '../chat/panel.ts'

import { collectDiagnostics, formatReport } from './diagnostics.ts'
import { HelpSheet } from './help-sheet.tsx'
import {
  useActiveApp,
  useAnnounceShellNavigation,
  useActionShortcuts,
  useShellActions,
  useShellSurface,
} from './hooks.ts'
import { negotiateNavigation } from './navigation.ts'
import { CommandPalette } from './palette.tsx'
import { ReleasesDialog } from './releases-dialog.tsx'
import { ReportBugDialog } from './report-bug-dialog.tsx'
import { SettingsSheet } from './settings-sheet.tsx'
import { ThemeAction } from './theme-action.tsx'
import { ShortcutKeys } from './shortcut-keys.tsx'
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
  // through the same hook; the runtime applies it to the document.
  const theme = useTheme()
  useAnnounceShellNavigation()
  // The shell's own actions and their keys, and the one listener every action's keys go
  // through — a mounted App's included, which renders in a React root of its own.
  useShellActions()
  useActionShortcuts()

  // `action` is forwarded rather than dropped, because refusing the back button while allowing a
  // redirect is a distinction an App is entitled to make.
  useBlocker({
    shouldBlockFn: async ({ current, next, action }) =>
      (await negotiateNavigation(runtime, current.pathname, next.pathname, action)) === 'blocked',
    // Asked of the blockers rather than counted, so an App that says `enableBeforeUnload: false`
    // is not overruled by the shell.
    enableBeforeUnload: () => runtime.navigator.wantsUnloadPrompt(),
  })

  // Stable across renders, because the provider's value changes with it and every link reads it.
  const navigateTo = useCallback(
    (href: string) => {
      void navigate({ to: href })
    },
    [navigate],
  )

  return (
    // A Tecton link with an `href` is a document navigation unless the provider carries a router,
    // and every breadcrumb click tore the shell down. It covers the surfaces too, whose rows link
    // to an application's pages; an App mounts in a root of its own, so none of this reaches it.
    <TectonProvider navigate={navigateTo}>
      <ThemeAction />
      {/* A third child of this grid would land in the `1fr` row and push the mounted App down the page. */}
      <AppShell>
        <Header />
        <AppShellBody>
          {/* The page is the split's first panel and the chat is added after it, so opening it never remounts the App mounted there. */}
          <ChatSplit>{children}</ChatSplit>
        </AppShellBody>
      </AppShell>

      {/* Every shell surface is mounted here and opened from the store, so none needs to know where another lives. */}
      <CommandPalette open={surface === 'palette'} onOpenChange={closeOnDismiss} />
      <SettingsSheet open={surface === 'settings'} onOpenChange={closeOnDismiss} />
      <HelpSheet open={surface === 'help'} onOpenChange={closeOnDismiss} />
      <ReleasesDialog open={surface === 'releases'} onOpenChange={closeOnDismiss} />
      <ReportBugDialog open={surface === 'bug'} onOpenChange={closeOnDismiss} />
      <ChatSheet />
      <ChatUnavailableSheet open={surface === 'assistant'} onOpenChange={closeOnDismiss} />
      {/* Not a member of `ShellSurface`: the developer tools own their open state and are not modal (§22). */}
      <MfeDevtools />
      {/* Explicit: the Toaster otherwise reads next-themes and falls back to the system preference. */}
      <Toaster position="bottom-right" theme={theme} />
    </TectonProvider>
  )
}

/** Opens and closes the assistant; pressed while it is open, it closes, as the aside's own button does. */
function AssistantAction(): ReactNode {
  const chat = useShellChat()
  const panel = useChatPanel(chat)
  return (
    <AppShellAction
      id={ASSISTANT_BUTTON_ID}
      label="Assistant"
      shortcut={<ShortcutKeys keys="mod+i" />}
      {...(chat === null
        ? {}
        : {
            'aria-pressed': panel.open,
            // The chat's code loads on first use; reaching for the button starts it early.
            onPointerEnter: () => {
              chat.preload()
            },
            onFocus: () => {
              chat.preload()
            },
          })}
      onClick={() => {
        if (chat === null) shellUi.toggle('assistant')
        else if (panel.open) chat.panel.hide()
        else chat.panel.focus()
      }}
    >
      <BotIcon />
    </AppShellAction>
  )
}

/** With sign-in off there is nothing to sign out of, and the menu says so rather than hiding it (§36). */
function SignOutItem(): ReactNode {
  const session = shellSession()

  if (session.mode === 'disabled') {
    return (
      <DropdownMenuItem disabled>
        <LogOutIcon /> Sign-in is off
      </DropdownMenuItem>
    )
  }

  return (
    <DropdownMenuItem
      onClick={() => {
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

/**
 * Switches once the menu has finished closing, when its content unmounts: restyling the whole page
 * while the menu animates out stutters the animation, and the item's own label would flip mid-fade.
 * `chosenRef` belongs to the menu, which clears it on reopening: content reopened before it finished
 * closing never unmounts, and the request must not fire on some later close.
 */
function ThemeItem({ chosenRef }: { readonly chosenRef: RefObject<boolean> }): ReactNode {
  const runtime = useMfeRuntime('the theme menu item')
  const theme = useTheme()
  useEffect(
    () => () => {
      if (!chosenRef.current) return
      chosenRef.current = false
      void runtime.actions.execute('@host:theme', { caller: 'ui' })
    },
    [runtime, chosenRef],
  )
  return (
    <DropdownMenuItem
      onClick={() => {
        chosenRef.current = true
      }}
    >
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
      {theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
    </DropdownMenuItem>
  )
}

/** The user's photo once it has loaded, or nothing, when the menu shows initials. */
function useAvatar(): string | undefined {
  const session = shellSession()
  const [image, setImage] = useState<string>()
  useEffect(() => {
    if (session.mode !== 'oidc') return undefined
    let current = true
    void session.avatar.then(url => {
      if (current) setImage(url)
    })
    return () => {
      current = false
    }
  }, [session])
  return image
}

function Header(): ReactNode {
  const runtime = useMfeRuntime('the shell header')
  const themeChosenRef = useRef(false)
  const navigate = useNavigate()
  const apps = useApps()
  const active = useActiveApp()
  // Subscribed rather than read off the store: a bare `getUser()` is a snapshot nothing re-runs.
  const user = useUser()
  const avatar = useAvatar()

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
            onSelect={id => {
              void (id === '@dashboard'
                ? navigate({ to: '/' })
                : navigate({ to: '/$appId', params: { appId: id } }))
            }}
          >
            <AppFinderGroup heading="Shell">
              <AppFinderItem
                value={DASHBOARD.id}
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
                  value={app.id}
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
        onClick={() => {
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
          shortcut={<ShortcutKeys keys="mod+k" />}
          onClick={() => {
            shellUi.show('palette')
          }}
        >
          Search or jump to…
        </AppShellCommandTrigger>
        <AssistantAction />
        <AppShellAction
          label="Help"
          shortcut={<ShortcutKeys keys="?" />}
          onClick={() => {
            shellUi.show('help')
          }}
        >
          <CircleHelpIcon />
        </AppShellAction>
        <AppShellAction
          label="What’s new"
          className="hidden lg:inline-flex"
          onClick={() => {
            shellUi.show('releases')
          }}
        >
          <SparklesIcon />
        </AppShellAction>
        <AppShellAction
          label="Report a bug"
          className="hidden lg:inline-flex"
          onClick={() => {
            shellUi.show('bug')
          }}
        >
          <BugIcon />
        </AppShellAction>
        <AppShellAction
          label="Settings"
          shortcut={<ShortcutKeys keys="g s" />}
          className="hidden lg:inline-flex"
          onClick={() => {
            shellUi.show('settings')
          }}
        >
          <SettingsIcon />
        </AppShellAction>

        <AppShellOverflow label="More" className="lg:hidden">
          <DropdownMenuGroup>
            <DropdownMenuItem
              onClick={() => {
                shellUi.show('releases')
              }}
            >
              <SparklesIcon /> What’s new
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                shellUi.show('bug')
              }}
            >
              <BugIcon /> Report a bug
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                shellUi.show('settings')
              }}
            >
              <SettingsIcon /> Settings
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </AppShellOverflow>

        <AppShellUserMenu
          onOpenChange={open => {
            if (open) themeChosenRef.current = false
          }}
          user={{
            name: user?.name ?? 'Unknown',
            initials,
            ...(avatar === undefined ? {} : { image: avatar }),
          }}
        >
          <DropdownMenuGroup>
            <ThemeItem chosenRef={themeChosenRef} />
            <DropdownMenuItem
              onClick={() => {
                shellUi.show('settings')
              }}
            >
              <SettingsIcon /> Settings
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                shellUi.show('help')
              }}
            >
              <CircleHelpIcon /> Help and keyboard shortcuts
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              onClick={() => {
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
        {trail.map((item, index) => {
          const last = index === trail.length - 1
          const page = last || item.href === undefined
          // A link crumb is hidden on narrow screens, and the separator after it goes with it.
          const visibility = page ? 'min-w-0' : 'hidden md:inline-flex'
          return (
            <Fragment key={item.key}>
              <Crumb className={visibility}>
                {page ? (
                  <BreadcrumbPage>{item.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink render={<Link href={item.href} />}>{item.label}</BreadcrumbLink>
                )}
              </Crumb>
              {last ? null : <BreadcrumbSeparator className={visibility} />}
            </Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
