import { createFileRoute } from '@tanstack/react-router'

/**
 * Settings, help and release notes are pages, so they are routes. Marking a
 * route is all an App does; the build extracts marked routes statically into
 * the manifest and the shell owns where they open.
 */
export const Route = createFileRoute('/settings')({
  staticData: {
    capability: 'settings',
    label: 'Operations settings',
    icon: 'settings',
  },
  component: () => (
    <section>
      <h2 className="text-lg font-medium">Operations settings</h2>
      <p className="text-sm text-muted-foreground">
        Opened by the shell, rendered by this App at its own route.
      </p>
    </section>
  ),
})
