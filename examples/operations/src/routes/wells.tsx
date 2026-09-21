import { createFileRoute, Outlet } from '@tanstack/react-router'
import type { ReactNode } from 'react'

/** A non-index route file with children is a layout whether it was written as one or not, so this renders
 * only an outlet and the list lives in `wells.index.tsx`. */
export const Route = createFileRoute('/wells')({
  staticData: { breadcrumb: 'Wells' },
  component: WellsLayout,
})

function WellsLayout(): ReactNode {
  return <Outlet />
}
