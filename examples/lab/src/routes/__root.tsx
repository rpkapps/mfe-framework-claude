import { createRootRouteWithContext, Link, Outlet, useMatchRoute } from '@tanstack/react-router'
import type { MfeRouterContext } from '@company/mfe-react'
import { ScrollArea } from '@tecton/react/components/scroll-area'
import type { LucideIcon } from 'lucide-react'
import {
  ActivityIcon,
  BoxIcon,
  DatabaseIcon,
  FilePenLineIcon,
  KeyRoundIcon,
  LayersIcon,
  ShieldAlertIcon,
  SlidersHorizontalIcon,
  TerminalIcon,
  UserIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'

export const Route = createRootRouteWithContext<MfeRouterContext>()({
  component: LabLayout,
})

const NAV: readonly { to: string; label: string; hint: string; icon: LucideIcon }[] = [
  { to: '/', label: 'Overview', hint: 'What is on this mount', icon: LayersIcon },
  { to: '/shell-state', label: 'Shell state', hint: 'user, groups, theme', icon: UserIcon },
  { to: '/storage', label: 'Storage', hint: 'validated, scoped, retained', icon: DatabaseIcon },
  { to: '/commands', label: 'Commands', hint: 'palette and denial', icon: TerminalIcon },
  { to: '/widgets', label: 'Widgets', hint: 'inputs, events, failure', icon: BoxIcon },
  { to: '/config', label: 'Config & fetch', hint: 'runtime config, auth', icon: KeyRoundIcon },
  { to: '/telemetry', label: 'Telemetry', hint: 'spans and logs', icon: ActivityIcon },
  {
    to: '/breadcrumbs',
    label: 'Breadcrumbs',
    hint: 'composed with the shell',
    icon: SlidersHorizontalIcon,
  },
  {
    to: '/unsaved',
    label: 'Unsaved edits',
    hint: 'blocking the shell',
    icon: FilePenLineIcon,
  },
  { to: '/failure', label: 'Failure', hint: 'errors that stay contained', icon: ShieldAlertIcon },
]

function LabLayout(): ReactNode {
  const matchRoute = useMatchRoute()
  const isActive = (to: string): boolean => matchRoute({ to, fuzzy: to !== '/' }) !== false

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col md:flex-row">
      {/*
       * The rail is the only way into nine of this App's ten pages, so below `md` it becomes a
       * scrolling strip of the same links rather than disappearing.
       */}
      <nav
        aria-label="Framework features"
        className="shrink-0 border-b border-border-subtle md:hidden"
      >
        <ScrollArea className="overflow-x-auto overflow-y-hidden">
          <ul className="flex w-max gap-1 p-2">
            {NAV.map(item => (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap transition-colors ${
                    isActive(item.to)
                      ? 'bg-accent font-medium text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                  }`}
                >
                  <item.icon className="size-4 shrink-0" />
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </ScrollArea>
      </nav>

      <nav
        aria-label="Framework features"
        className="hidden w-64 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border-subtle p-2 md:flex"
      >
        {NAV.map(item => (
          <Link
            key={item.to}
            to={item.to}
            className={`flex items-start gap-2 rounded-md px-2 py-1.5 transition-colors ${
              isActive(item.to)
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
            }`}
          >
            <item.icon className="mt-0.5 size-4 shrink-0" />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium">{item.label}</span>
              <span className="truncate text-xs opacity-70">{item.hint}</span>
            </span>
          </Link>
        ))}
      </nav>

      <main className="min-w-0 flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
