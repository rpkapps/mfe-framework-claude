import { createFileRoute } from '@tanstack/react-router'

// Settings, help and release notes are pages, so they are routes. Marking one
// is all an App does; the build extracts it into the manifest and the shell
// decides where it opens.
export const Route = createFileRoute('/settings')({
  staticData: {
    capability: 'settings',
    label: 'canvas-01 settings',
    icon: 'settings',
  },
  component: () => <h2>Settings</h2>,
})
