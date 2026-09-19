import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { WellsListPage } from '@tecton/react/blocks/list-01/page.tsx'
import type { ReactNode } from 'react'

/**
 * A whole page composed from one design-system block. An MFE does not earn its
 * keep by re-drawing tables; it earns it by owning a routable surface that
 * deploys on its own.
 */
export const Route = createFileRoute('/wells')({
  staticData: { breadcrumb: 'Wells' },
  component: Wells,
})

function Wells(): ReactNode {
  const navigate = useNavigate()

  return (
    <WellsListPage
      onOpen={well => {
        void navigate({ to: '/wells/$wellId', params: { wellId: well.id } })
      }}
    />
  )
}
