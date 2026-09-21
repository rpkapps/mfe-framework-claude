/** Four Widgets in one container is a deployment decision, not a framework one: a host reaches each
 * by its own id and never learns they are neighbours. */

import { createWidget } from '@company/mfe-react'
import { z } from 'zod'

import {
  AgentPanelWidget,
  CostVsRiskWidget,
  FdaSummaryWidget,
  WellDesignWidget,
} from './widgets.tsx'

/** The build reads these schemas statically into the registry, so `z.enum([...])` is what makes the
 * shell's dashboard draw a dropdown for a Widget it never imported (§16). */
export const fdaSummaryContract = {
  inputs: z.object({
    fdaId: z.enum(['fda-1-02', 'fda-2-3', 'fda-1-2']),
    showActions: z.boolean().default(true),
  }),
  events: {
    selected: z.object({ fdaId: z.string(), selected: z.boolean() }),
    opened: z.object({ fdaId: z.string(), title: z.string() }),
  },
}

export const fdaSummary = createWidget({
  id: 'fda-summary',
  version: '1.0.0',
  ...fdaSummaryContract,
  render: FdaSummaryWidget,
})

export const wellDesignContract = {
  inputs: z.object({
    wellId: z.enum(['reduced-dls', 'htdp', 'liner']),
  }),
  events: {
    selected: z.object({ wellId: z.string(), selected: z.boolean() }),
    viewed: z.object({ wellId: z.string(), well: z.string() }),
  },
}

export const wellDesign = createWidget({
  id: 'well-design',
  version: '1.0.0',
  ...wellDesignContract,
  render: WellDesignWidget,
})

export const costVsRiskContract = {
  inputs: z.object({
    compare: z.array(z.enum(['initial', 'dls', 'htdp', 'liner'])).default(['initial', 'liner']),
  }),
  events: {},
}

export const costVsRisk = createWidget({
  id: 'cost-vs-risk',
  version: '1.0.0',
  ...costVsRiskContract,
  render: CostVsRiskWidget,
})

export const agentPanelContract = {
  inputs: z.object({
    heading: z.string().default('AI Agent'),
  }),
  events: {
    closed: z.object({ at: z.string() }),
  },
}

export const agentPanel = createWidget({
  id: 'agent-panel',
  version: '0.9.0',
  ...agentPanelContract,
  render: AgentPanelWidget,
})
