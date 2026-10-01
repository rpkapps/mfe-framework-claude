import { createFileRoute } from '@tanstack/react-router'

import { SharedStatePage } from '../shared-state-page.tsx'

export const Route = createFileRoute('/shared-state')({
  staticData: { breadcrumb: 'Shared state' },
  loader: ({ context }) => context.mfe.sharedState.get('well:selection'),
  component: SharedStatePage,
})
