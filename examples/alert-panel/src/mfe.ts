/**
 * A Widget: a non-routable, independently mountable surface.
 *
 * The schemas are the source of truth for both runtime validation and the
 * author-facing types, so `inputs` and `emit` in the render function are fully
 * typed without a single type annotation to keep in sync. The build reads the
 * same schemas statically and publishes them in the registry, which is what
 * lets a host offer this Widget in a catalogue without loading this container.
 *
 * The contract is exported separately so a consumer can import it and get
 * inference plus consumer-side event validation. A consumer may equally declare
 * its own tolerant contract containing only the fields it uses.
 *
 * The render function lives in its own module. This one exports a contract and
 * a definition, so React Refresh cannot replace it and an edit here reloads the
 * page; `alert-panel.tsx` exports only a component and hot-updates.
 */

import { createWidget } from '@company/mfe-react'
import { z } from 'zod'

import { AlertPanel } from './alert-panel.tsx'

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

export const alertPanel = createWidget({
  id: 'alert-panel',
  version: '1.4.0',
  ...alertPanelContract,
  render: AlertPanel,
})
