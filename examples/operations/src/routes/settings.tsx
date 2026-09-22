import { createFileRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { SettingsPage } from '../components/settings-01/page.tsx'

/** A marked route is extracted into the container's registry entry, and the shell owns where it opens. */
export const Route = createFileRoute('/settings')({
  staticData: {
    capability: 'settings',
    label: 'Operations settings',
    icon: 'settings',
    breadcrumb: 'Settings',
  },
  component: Settings,
})

function Settings(): ReactNode {
  return <SettingsPage />
}
