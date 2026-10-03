import { createFileRoute } from '@tanstack/react-router'

import { UserContextPage } from '../user-context-page.tsx'

export const Route = createFileRoute('/user-context')({
  staticData: { breadcrumb: 'User context' },
  loader: ({ context }) => context.mfe.userContext.get('well-selection'),
  component: UserContextPage,
})
