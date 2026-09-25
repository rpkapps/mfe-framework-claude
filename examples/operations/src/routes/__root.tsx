import {
  createRootRouteWithContext,
  Link,
  Outlet,
  useMatchRoute,
  useNavigate,
} from '@tanstack/react-router'
import { allow, deny, useAction, useGroups, type MfeRouterContext } from '@company/mfe-react'
import { ScrollArea } from '@tecton/react/components/scroll-area'
import {
  BoxesIcon,
  DrillIcon,
  FileBarChartIcon,
  LayoutGridIcon,
  SettingsIcon,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'

import { ProjectTree, projectTree } from '../components/dashboard-01/page.tsx'

/** The shell owns the header above this and renders nothing else, so everything below it is this
 * App's to lay out; `createApp` has no layout option because a root route already is one. */
export const Route = createRootRouteWithContext<MfeRouterContext>()({
  component: OperationsLayout,
})

/** `basepath` resolves these under whatever boundary the shell assigned, so the App never sees its
 * own mount prefix. */
const NAV: readonly { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/', label: 'Overview', icon: LayoutGridIcon },
  { to: '/assets', label: 'Assets', icon: BoxesIcon },
  { to: '/wells', label: 'Wells', icon: DrillIcon },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
]

/** One class string for the compact strip's links, active or not. */
function stripLink(isActive: boolean): string {
  return `flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap transition-colors ${
    isActive
      ? 'bg-accent font-medium text-accent-foreground'
      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
  }`
}

function OperationsLayout(): ReactNode {
  const matchRoute = useMatchRoute()
  const navigate = useNavigate()
  const groups = useGroups()

  /*
   * Registered by the layout rather than by a page, so they live as long as this application is
   * mounted; a page's own action is scoped to that page instead.
   */
  useAction({
    name: 'open-wells',
    label: 'Operations: open the wells inventory',
    // Fires while the page is inside this App; the shell's own keys are reserved, so an App's
    // sequences start with a letter the shell leaves free.
    shortcut: 'o w',
    canExecute: () => allow(),
    execute: () => {
      void navigate({ to: '/wells' })
    },
  })

  useAction({
    name: 'open-assets',
    label: 'Operations: open the asset list',
    shortcut: 'o a',
    canExecute: () => allow(),
    execute: () => {
      void navigate({ to: '/assets' })
    },
  })

  useAction({
    name: 'open-settings',
    label: 'Operations: open settings',
    canExecute: () => allow(),
    execute: () => {
      void navigate({ to: '/settings' })
    },
  })

  useAction({
    name: 'open-reports',
    label: 'Operations: open the alternatives ranking',
    // The one surface in this App that a group actually gates.
    canExecute: () =>
      groups.includes('well-planning.read')
        ? allow()
        : deny('You need the well-planning.read group to open the ranking.'),
    execute: () => {
      void navigate({ to: '/reports/$', params: { _splat: '' } })
    },
  })

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col lg:flex-row">
      {/*
       * The rail is the only way into this App's other pages, so below `lg` it becomes a scrolling
       * strip of the same links rather than disappearing.
       */}
      <nav aria-label="Operations" className="shrink-0 border-b border-border-subtle lg:hidden">
        <ScrollArea className="overflow-x-auto overflow-y-hidden">
          <ul className="flex w-max gap-1 p-2">
            {NAV.map(item => (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className={stripLink(
                    matchRoute({ to: item.to, fuzzy: item.to !== '/' }) !== false,
                  )}
                >
                  <item.icon className="size-4 shrink-0" />
                  {item.label}
                </Link>
              </li>
            ))}
            {/* The delegated child App: the same link as the rail's, which
                names the splat route with an empty splat. */}
            <li>
              <Link
                to="/reports/$"
                params={{ _splat: '' }}
                className={stripLink(matchRoute({ to: '/reports/$', fuzzy: true }) !== false)}
              >
                <FileBarChartIcon className="size-4 shrink-0" />
                Reports
              </Link>
            </li>
          </ul>
        </ScrollArea>
      </nav>

      <aside className="hidden w-60 shrink-0 flex-col border-r border-border-subtle lg:flex">
        <nav className="flex flex-col gap-0.5 p-2" aria-label="Operations">
          {NAV.map(item => {
            const isActive = matchRoute({ to: item.to, fuzzy: item.to !== '/' }) !== false
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
                  isActive
                    ? 'bg-accent font-medium text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                }`}
              >
                <item.icon className="size-4" />
                {item.label}
              </Link>
            )
          })}

          {/* An empty splat is what lands on the child App's own index. */}
          <Link
            to="/reports/$"
            params={{ _splat: '' }}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
          >
            <FileBarChartIcon className="size-4" />
            Reports
          </Link>
        </nav>

        <div className="flex min-h-0 flex-1 flex-col border-t border-border-subtle">
          <ScrollArea>
            <ProjectTree nodes={projectTree} />
          </ScrollArea>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
