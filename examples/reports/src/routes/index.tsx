import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { FdaComparisonTable } from '@tecton/react/blocks/fda-comparison-table/page.tsx'
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderEyebrow,
  PageHeaderTitle,
} from '@tecton/react/tecton/page-header'
import type { ReactNode } from 'react'

export const Route = createFileRoute('/')({
  staticData: { breadcrumb: 'Reports' },
  component: Reports,
})

function Reports(): ReactNode {
  const navigate = useNavigate()

  return (
    <div className="flex flex-col gap-6 px-4 py-6 md:px-6">
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderEyebrow>Reports</PageHeaderEyebrow>
          <PageHeaderTitle>Alternatives ranking</PageHeaderTitle>
          <PageHeaderDescription>
            This whole page is a second application, deployed on its own. Reached directly it owns
            the boundary; reached through Operations it is delegated at a route and reads its own
            URL below whatever prefix it was given.
          </PageHeaderDescription>
        </PageHeaderContent>
      </PageHeader>

      <FdaComparisonTable
        onOpen={fda => {
          void navigate({ to: '/accounts/$accountId', params: { accountId: fda.id } })
        }}
      />
    </div>
  )
}
