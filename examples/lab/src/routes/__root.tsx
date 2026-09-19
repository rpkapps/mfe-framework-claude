import { createRootRouteWithContext, Link, Outlet, useMatchRoute } from '@tanstack/react-router'
import type { MfeRouterContext } from '@company/mfe-react'
import type { LucideIcon } from 'lucide-react'
import {
  ActivityIcon,
  BoxIcon,
  DatabaseIcon,
  KeyRoundIcon,
  LayersIcon,
  ShieldAlertIcon,
  SlidersHorizontalIcon,
  TerminalIcon,
  UserIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * The framework lab: one page per thing the framework does, each with a control
 * that makes it visible.
 *
 * Every page here is an ordinary route in an ordinary TanStack Router
 * application. That is the claim being demonstrated as much as any individual
 * feature — an App author writes a router application, and the micro-frontend
 * concerns show up as hooks and generated modules rather than as a framework to
 * learn.
 */
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
  { to: '/failure', label: 'Failure', hint: 'errors that stay contained', icon: ShieldAlertIcon },
]

function LabLayout(): ReactNode {
  const matchRoute = useMatchRoute()

  return (
    <div className="flex min-h-0 w-full flex-1">
      <nav
        aria-label="Framework features"
        className="hidden w-64 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border-subtle p-2 md:flex"
      >
        {NAV.map(item => {
          const isActive = matchRoute({ to: item.to, fuzzy: item.to !== '/' }) !== false
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`flex items-start gap-2 rounded-md px-2 py-1.5 transition-colors ${
                isActive
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
          )
        })}
      </nav>

      <main className="min-w-0 flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
