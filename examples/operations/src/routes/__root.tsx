import { createRootRouteWithContext, Link, Outlet, useMatchRoute } from '@tanstack/react-router'
import type { MfeRouterContext } from '@company/mfe-react'
import { ScrollArea } from '@tecton/react/components/scroll-area'
import { ProjectTree, projectTree } from '@tecton/react/blocks/dashboard-01/page.tsx'
import {
  BoxesIcon,
  DrillIcon,
  FileBarChartIcon,
  LayoutGridIcon,
  SettingsIcon,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * A layout is a root route with an outlet, which is the native way to express
 * it. There is no layout or render option on createApp.
 *
 * The shell owns the header above this and renders nothing else, so the region
 * below it is this App's to lay out — a navigation rail and its own scrolling
 * body. An App that wanted a single centred column would render that instead;
 * the framework has no opinion.
 */
export const Route = createRootRouteWithContext<MfeRouterContext>()({
  component: OperationsLayout,
})

/**
 * `basepath` makes every link resolve under whatever boundary the shell
 * assigned, so the App writes ordinary absolute-looking paths and never sees
 * its own mount prefix.
 */
const NAV: readonly { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/', label: 'Overview', icon: LayoutGridIcon },
  { to: '/assets', label: 'Assets', icon: BoxesIcon },
  { to: '/wells', label: 'Wells', icon: DrillIcon },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
]

function OperationsLayout(): ReactNode {
  const matchRoute = useMatchRoute()

  return (
    <div className="flex min-h-0 w-full flex-1">
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

          {/*
           * The child App is delegated at a splat route, so the link names that
           * route with an empty splat and the child's own index renders.
           */}
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
