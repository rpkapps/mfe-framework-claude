import { createFileRoute, Outlet } from '@tanstack/react-router'
import { useFumadocsLoader } from 'fumadocs-core/source/client'

import { SiteFooter } from '../components/site-footer.tsx'
import { SiteHeader } from '../components/site-header.tsx'
import { getPageTree } from '../lib/page-tree.ts'

export const Route = createFileRoute('/_site')({
  loader: () => getPageTree(),
  component: SiteLayout,
})

function SiteLayout() {
  const { pageTree } = useFumadocsLoader(Route.useLoaderData())

  return (
    <div
      data-slot="layout"
      className="group/layout relative z-10 flex min-h-svh flex-col bg-background"
    >
      <SiteHeader tree={pageTree} />
      <main className="flex min-h-0 flex-1 flex-col">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  )
}
