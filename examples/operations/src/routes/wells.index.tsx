import { createFileRoute, useNavigate } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { WellsListPage } from '../components/list-01/page.tsx'

export const Route = createFileRoute('/wells/')({
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
