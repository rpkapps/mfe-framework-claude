import { createFileRoute } from '@tanstack/react-router'

import { wellSelection } from '../storage.ts'
import { UserStoragePage } from '../user-storage-page.tsx'

export const Route = createFileRoute('/user-storage')({
  staticData: { breadcrumb: 'User storage' },
  // The App mounts once the user's values have loaded, so this reads the saved selection.
  loader: ({ context }) => context.mfe.storage.get(wellSelection),
  component: UserStoragePage,
})
