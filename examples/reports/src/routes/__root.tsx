import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import type { MfeRouterContext } from '@company/mfe-react'

export const Route = createRootRouteWithContext<MfeRouterContext>()({
  component: () => <Outlet />,
})
