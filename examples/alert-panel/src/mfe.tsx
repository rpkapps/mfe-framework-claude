/**
 * A Widget: a non-routable, independently mountable surface.
 *
 * The schemas are the source of truth for both runtime validation and the
 * author-facing types, so `inputs` and `emit` below are fully typed without a
 * single type annotation to keep in sync.
 *
 * The contract is exported separately so a consumer can import it and get
 * inference plus consumer-side event validation. A consumer may equally declare
 * its own tolerant contract containing only the fields it uses.
 */

import { createWidget } from '@company/mfe-react'
import { z } from 'zod'

export const alertPanelContract = {
  inputs: z.object({
    alertId: z.string(),
    severity: z.enum(['info', 'warning', 'critical']).default('info'),
  }),
  events: {
    acknowledged: z.object({ alertId: z.string(), acknowledgedAt: z.string() }),
    dismissed: z.object({ alertId: z.string() }),
  },
}

const SEVERITY_LABEL = {
  info: 'Informational',
  warning: 'Needs attention',
  critical: 'Critical',
} as const

export const alertPanel = createWidget({
  id: 'alert-panel',
  version: '1.4.0',
  ...alertPanelContract,

  render: function AlertPanel({ inputs, emit }) {
    return (
      <section className="rounded-lg border border-border bg-card p-4">
        <header className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-medium">Alert {inputs.alertId}</h3>
          <span className="text-xs text-muted-foreground">{SEVERITY_LABEL[inputs.severity]}</span>
        </header>

        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
            onClick={() =>
              emit('acknowledged', {
                alertId: inputs.alertId,
                acknowledgedAt: new Date().toISOString(),
              })
            }
          >
            Acknowledge
          </button>

          <button
            type="button"
            className="rounded-md border border-border px-3 py-1.5 text-sm"
            onClick={() => emit('dismissed', { alertId: inputs.alertId })}
          >
            Dismiss
          </button>
        </div>
      </section>
    )
  },
})
