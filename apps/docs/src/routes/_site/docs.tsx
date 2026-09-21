import { createFileRoute, getRouteApi, Outlet } from '@tanstack/react-router'
import { SidebarProvider } from '@tecton/react/components/sidebar'
import { useFumadocsLoader } from 'fumadocs-core/source/client'

import { DocsSidebar } from '../../components/docs-sidebar.tsx'

export const Route = createFileRoute('/_site/docs')({
  component: DocsLayout,
})

const siteRoute = getRouteApi('/_site')

function DocsLayout() {
  const { pageTree } = useFumadocsLoader(siteRoute.useLoaderData())

  return (
    <div className="container-wrapper flex flex-1 flex-col px-2">
      <SidebarProvider className="min-h-min flex-1 items-start px-0 [--sidebar-width:calc(var(--spacing)*72)] [--top-spacing:0] lg:grid lg:grid-cols-[var(--sidebar-width)_minmax(0,1fr)] lg:[--top-spacing:calc(var(--spacing)*4)]">
        <DocsSidebar tree={pageTree} />
        <div className="h-full w-full">
          <Outlet />
        </div>
      </SidebarProvider>
    </div>
  )
}
