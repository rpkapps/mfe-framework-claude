import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import type { MfeRouterContext } from '@company/mfe-react'

// A layout is a root route with an outlet, which is the native way to say it.
export const Route = createRootRouteWithContext<MfeRouterContext>()({
  component: () => <Outlet />,
})
