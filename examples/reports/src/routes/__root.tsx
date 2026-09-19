import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import type { MfeRouterContext } from '@company/mfe-react'

/**
 * A child App's layout. It renders no chrome of its own: this App is mounted
 * inside another App's page as often as it is mounted at a boundary of its own,
 * and a second header would be wrong in both.
 */
export const Route = createRootRouteWithContext<MfeRouterContext>()({
  component: () => <Outlet />,
})
