/** `inputs` arrives already validated and `emit` refuses any output the contract does not declare, so
 * neither needs a check here. */

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

  // Unreachable through the contract's enum, but a rename in the component's own data would
  // otherwise crash the host's page.
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
    // The panel fills its container, so the height is this Widget's choice of how much room to take.
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
