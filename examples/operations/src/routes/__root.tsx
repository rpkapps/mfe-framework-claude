import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router'
import type { MfeRouterContext } from '@company/mfe-react'

/**
 * A layout is a root route with an outlet, which is the native way to express
 * it. There is no layout or render option on createApp.
 */
export const Route = createRootRouteWithContext<MfeRouterContext>()({
  component: OperationsLayout,
})

function OperationsLayout() {
  return (
    <div className="flex h-full flex-col">
      <nav className="flex gap-4 border-b border-border px-6 py-3 text-sm">
        {/* basepath makes these resolve under the assigned boundary, so the
            App writes ordinary absolute-looking paths. */}
        <Link to="/" className="text-muted-foreground hover:text-foreground">
          Overview
        </Link>
        <Link to="/assets" className="text-muted-foreground hover:text-foreground">
          Assets
        </Link>
        <Link to="/reports" className="text-muted-foreground hover:text-foreground">
          Reports
        </Link>
      </nav>

      <main className="flex-1 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  )
}
