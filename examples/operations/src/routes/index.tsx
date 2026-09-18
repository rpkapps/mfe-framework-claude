import { createFileRoute } from '@tanstack/react-router'
import { useUser, useTheme, useStoredState, useCommand, allow, deny } from '@company/mfe-react'
import { z } from 'zod'

import { AlertPanel } from '../widgets.ts'

export const Route = createFileRoute('/')({
  staticData: { breadcrumb: 'Overview' },
  component: Overview,
})

// Declared at module scope, as the storage contract requires.
const densitySchema = z.enum(['comfortable', 'compact'])

function Overview() {
  const user = useUser()
  const theme = useTheme()

  // A subscribed value and a stable setter. No effect keeps it in sync.
  const [density, setDensity] = useStoredState('table-density', densitySchema, {
    defaultValue: 'comfortable',
    retention: 'preference',
  })

  // Registration is a hook, so mount scoping follows component lifetime. The
  // inline callbacks below need no memoization to stay current.
  useCommand({
    name: 'toggle-density',
    label: `Switch to ${density === 'compact' ? 'comfortable' : 'compact'} density`,
    canExecute: () => (user ? allow() : deny('Sign in to change display preferences.')),
    execute: () => setDensity(current => (current === 'compact' ? 'comfortable' : 'compact')),
  })

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-medium">Operations</h1>
        <p className="text-sm text-muted-foreground">
          Signed in as {user?.name ?? 'nobody'}. Theme is {theme}. Density is {density}.
        </p>
      </header>

      {/* A Widget from another container, consumed as an ordinary component:
          inputs are props and events are onX props. */}
      <AlertPanel
        alertId="a-1001"
        severity="warning"
        onAcknowledged={event => console.info('acknowledged', event.alertId, event.acknowledgedAt)}
        fallback={({ error, retry }) => (
          <div role="alert" className="rounded-md border border-border p-4">
            <p className="text-sm">{error.message}</p>
            <button type="button" onClick={retry} className="mt-2 text-sm underline">
              Retry
            </button>
          </div>
        )}
      />
    </div>
  )
}
