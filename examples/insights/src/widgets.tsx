/**
 * The render functions behind this container's Widgets.
 *
 * Separate from `mfe.tsx` so the entry stays a readable list of contracts: the
 * entry is the file a reviewer reads to learn what this container provides, and
 * the file the build parses to publish those contracts.
 *
 * `inputs` arrives validated against the schema — the framework rejects
 * anything else before this code runs — and `emit` refuses any event the
 * contract does not declare, with the payload checked against its schema on the
 * way out. Neither needs a check here.
 */

import type { WidgetRenderProps } from '@company/mfe-react'
import { useState, type ReactNode } from 'react'

import { AiAgentPanel } from './components/ai-agent-panel/page.tsx'
import { CostVsRiskPanel } from './components/cost-vs-risk-panel/page.tsx'
import { FdaCard, fdaSummaries } from './components/fda-card/page.tsx'
import { WellDesignCard, wellDesigns } from './components/well-design-card/page.tsx'
import type {
  agentPanelContract,
  costVsRiskContract,
  fdaSummaryContract,
  wellDesignContract,
} from './mfe.tsx'

export function FdaSummaryWidget({
  inputs,
  emit,
}: WidgetRenderProps<typeof fdaSummaryContract>): ReactNode {
  const [selected, setSelected] = useState(false)
  const fda = fdaSummaries.find(candidate => candidate.id === inputs.fdaId)

  // The enum makes this unreachable through the contract, and the fallback is
  // still here: the data this renders from is the component's, and a rename
  // there would otherwise crash the host's page.
  if (fda === undefined) return <Unknown what={`alternative ${inputs.fdaId}`} />

  return (
    <FdaCard
      fda={fda}
      isSelected={selected}
      onSelectedChange={next => {
        setSelected(next)
        emit('selected', { fdaId: fda.id, selected: next })
      }}
      {...(inputs.showActions
        ? {
            onOpen: () => {
              emit('opened', { fdaId: fda.id, title: fda.title })
            },
          }
        : {})}
    />
  )
}

export function WellDesignWidget({
  inputs,
  emit,
}: WidgetRenderProps<typeof wellDesignContract>): ReactNode {
  const [selected, setSelected] = useState(false)
  const design = wellDesigns.find(candidate => candidate.id === inputs.wellId)

  if (design === undefined) return <Unknown what={`well design ${inputs.wellId}`} />

  return (
    <WellDesignCard
      design={design}
      isSelected={selected}
      onSelectedChange={next => {
        setSelected(next)
        emit('selected', { wellId: design.id, selected: next })
      }}
      onView={() => {
        emit('viewed', { wellId: design.id, well: design.well })
      }}
    />
  )
}

export function CostVsRiskWidget({
  inputs,
}: WidgetRenderProps<typeof costVsRiskContract>): ReactNode {
  return <CostVsRiskPanel defaultSelected={[...inputs.compare]} variant="flat" />
}

export function AgentPanelWidget({
  inputs,
  emit,
}: WidgetRenderProps<typeof agentPanelContract>): ReactNode {
  return (
    // The panel is designed to fill its container; the height is this Widget's
    // choice of how much room to take in whatever laid it out.
    <div className="h-112">
      <AiAgentPanel
        aria-label={inputs.heading}
        onClose={() => {
          emit('closed', { at: new Date().toISOString() })
        }}
      />
    </div>
  )
}

function Unknown({ what }: { readonly what: string }): ReactNode {
  return (
    <p role="alert" className="p-4 text-sm text-muted-foreground">
      No {what} in this container’s data.
    </p>
  )
}
