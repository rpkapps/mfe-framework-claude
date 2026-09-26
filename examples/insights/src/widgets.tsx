/** `inputs` arrives already validated and `emit` refuses any output the contract does not declare, so
 * neither needs a check here. */

import { useAgentPrompt, type WidgetRenderProps } from '@company/mfe-react'
import { useState, type ReactNode } from 'react'

import { CostVsRiskPanel } from './components/cost-vs-risk-panel/page.tsx'
import { FdaCard, fdaSummaries } from './components/fda-card/page.tsx'
import { WellDesignCard, wellDesigns } from './components/well-design-card/page.tsx'
import type { costVsRiskContract, fdaSummaryContract, wellDesignContract } from './mfe.tsx'

/** A host changes a Widget's inputs in place rather than remounting it, so each card is keyed on
 * the id it shows: otherwise a selection made on one alternative would carry over to the next. */
export function FdaSummaryWidget({
  inputs,
  emit,
}: WidgetRenderProps<typeof fdaSummaryContract>): ReactNode {
  return <FdaSummary key={inputs.fdaId} inputs={inputs} emit={emit} />
}

function FdaSummary({ inputs, emit }: WidgetRenderProps<typeof fdaSummaryContract>): ReactNode {
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
  return <WellDesign key={inputs.wellId} inputs={inputs} emit={emit} />
}

function WellDesign({ inputs, emit }: WidgetRenderProps<typeof wellDesignContract>): ReactNode {
  const [selected, setSelected] = useState(false)
  // The explicit way a Widget hands something to the agent: a new turn, from the user's own press
  // and nothing else (never a timer or an error handler). With no chat on the page it does nothing.
  const ask = useAgentPrompt()
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
      onAsk={() =>
        ask({
          message: `What stands out in the ${design.well} design?`,
          context: { wellId: design.id, well: design.well },
        })
      }
    />
  )
}

export function CostVsRiskWidget({
  inputs,
}: WidgetRenderProps<typeof costVsRiskContract>): ReactNode {
  // The panel only seeds its selection from `defaultSelected`, so a later `compare` would be
  // ignored. Keying on the comparison starts the panel over, axes included, when the host asks for a
  // different one, which is simpler than making it controlled; the user's own chip changes last
  // until then. The key is the ids rather than the array, which a host may rebuild unchanged.
  return (
    <CostVsRiskPanel
      key={inputs.compare.join(',')}
      defaultSelected={[...inputs.compare]}
      variant="flat"
    />
  )
}

function Unknown({ what }: { readonly what: string }): ReactNode {
  return (
    <p role="alert" className="p-4 text-sm text-muted-foreground">
      No {what} in this container’s data.
    </p>
  )
}
