import { createFileRoute } from '@tanstack/react-router'
import { SettingsPage } from '@tecton/blocks/settings-01/page.tsx'
import type { ReactNode } from 'react'

/**
 * Settings, help and release notes are pages, so they are routes. Marking a
 * route is all an App does; the build extracts marked routes statically into
 * the container descriptor and the shell owns where they open.
 */
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
