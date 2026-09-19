import { createFileRoute, Outlet } from '@tanstack/react-router'
import type { ReactNode } from 'react'

/**
 * The layout for everything under `/wells`, and nothing else.
 *
 * It renders only an outlet, and that is the point of it existing. This file
 * used to *be* the list, which made it the parent of `/wells/$wellId` with no
 * outlet in it — so opening a well matched the detail route, rendered the list
 * instead, and the detail page was unreachable from anywhere in the
 * application. A non-index route file with children is a layout whether or not
 * it was written as one; the list belongs in `wells.index.tsx`.
 */
export const Route = createFileRoute('/wells')({
  staticData: { breadcrumb: 'Wells' },
  component: WellsLayout,
})

function WellsLayout(): ReactNode {
  return <Outlet />
}
