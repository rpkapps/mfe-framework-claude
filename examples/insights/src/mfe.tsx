/**
 * A Widget container: four non-routable surfaces, independently mountable, all
 * deployed as one unit.
 *
 * Four Widgets in one container rather than four containers is a deployment
 * decision, not a framework one — they change together, so they ship together.
 * Nothing about consuming them changes: a host reaches each one by its own id
 * and never learns they are neighbours.
 *
 * Every Widget here is a thin wrapper over a Tecton block. That is the point:
 * the interesting part of a Widget is its contract — what it takes, what it
 * emits, and the fact that both are validated at this boundary — and not the
 * markup, which is the design system's.
 */

import { createWidget } from '@company/mfe-react'
import { z } from 'zod'

import {
  AgentPanelWidget,
  CostVsRiskWidget,
  FdaSummaryWidget,
  WellDesignWidget,
} from './widgets.tsx'

/**
 * The schemas are the source of truth twice over: the provider validates
 * against them at runtime, and the build reads them statically to publish an
 * input schema in the registry — which is what lets a host that never imported
 * this container offer these Widgets in a catalogue and ask for their inputs.
 *
 * So `z.enum([...])` here is not decoration. It is why the shell's dashboard
 * shows a dropdown of alternative ids rather than a text box.
 */
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
    /** Which designs start compared. Free text so the catalogue shows a list. */
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
