/** Four Widgets in one container is a deployment decision, not a framework one: a host reaches each
 * by its own id and never learns they are neighbours. */

import { createWidget } from '@company/mfe-react'
import { ChartScatterIcon, ClipboardListIcon, RouteIcon } from 'lucide-react'
import { z } from 'zod'

import { CostVsRiskWidget, FdaSummaryWidget, WellDesignWidget } from './widgets.tsx'

/** The build reads these schemas statically into the registry, so `z.enum([...])` is what makes the
 * shell's dashboard draw a dropdown for a Widget it never imported (§16). */
export const fdaSummaryContract = {
  inputSchema: z.object({
    fdaId: z.enum(['fda-1-02', 'fda-2-3', 'fda-1-2']),
    showActions: z.boolean().default(true),
  }),
  outputSchema: z.object({
    selected: z.object({ fdaId: z.string(), selected: z.boolean() }),
    opened: z.object({ fdaId: z.string(), title: z.string() }),
  }),
}

export const fdaSummary = createWidget({
  id: 'fda-summary',
  version: '1.0.0',
  title: 'FDA summary',
  description: 'Headline figures for a field development area, with drill-down actions.',
  tags: ['insights', 'planning', 'summary'],
  icon: ClipboardListIcon,
  ...fdaSummaryContract,
  render: FdaSummaryWidget,
})

export const wellDesignContract = {
  inputSchema: z.object({
    wellId: z.enum(['reduced-dls', 'htdp', 'liner']),
  }),
  outputSchema: z.object({
    selected: z.object({ wellId: z.string(), selected: z.boolean() }),
    viewed: z.object({ wellId: z.string(), well: z.string() }),
  }),
}

export const wellDesign = createWidget({
  id: 'well-design',
  version: '1.0.0',
  title: 'Well design',
  description: 'Trajectory and casing for one candidate design.',
  tags: ['insights', 'planning', 'drilling'],
  icon: RouteIcon,
  ...wellDesignContract,
  render: WellDesignWidget,
})

export const costVsRiskContract = {
  inputSchema: z.object({
    compare: z.array(z.enum(['initial', 'dls', 'htdp', 'liner'])).default(['initial', 'liner']),
  }),
  outputSchema: z.object({}),
}

export const costVsRisk = createWidget({
  id: 'cost-vs-risk',
  version: '1.0.0',
  title: 'Cost vs risk',
  description: 'Compares candidate designs on cost against assessed risk.',
  tags: ['insights', 'analysis', 'drilling'],
  icon: ChartScatterIcon,
  ...costVsRiskContract,
  render: CostVsRiskWidget,
})
