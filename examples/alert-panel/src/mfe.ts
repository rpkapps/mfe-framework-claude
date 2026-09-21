/** The build reads these schemas statically and publishes them in the registry, so a host can offer
 * this Widget in a catalogue without loading the container (§16). The render function lives in
 * `alert-panel.tsx` because a module exporting a contract and a definition is no React Refresh
 * boundary, so an edit here would reload the page (§18). */

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
