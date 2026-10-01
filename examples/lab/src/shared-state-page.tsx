import { useState, type ReactNode } from 'react'
import { useLoaderData, useRouter } from '@tanstack/react-router'
import { Alert, AlertDescription, AlertTitle } from '@tecton/react/components/alert'
import { Button } from '@tecton/react/components/button'
import { useSharedState, useSharedStateStore } from '#mfe/shared-state'

import { DataList, DataRow, LabPage, LabSection, Value } from './lab-page.tsx'

export function SharedStatePage(): ReactNode {
  const [units, setUnits] = useSharedState('display:units')
  const [selection, setSelection] = useSharedState('well:selection')
  const store = useSharedStateStore()
  const router = useRouter()
  const loadedSelection = useLoaderData({ from: '/shared-state' })
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  async function save(write: () => Promise<void>): Promise<void> {
    setPending(true)
    try {
      await write()
      await router.invalidate()
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(false)
    }
  }

  return (
    <LabPage
      eyebrow="Shared state"
      title="One selection, two frameworks"
      description="The Lab and Fieldwork import their schema from @example/shared-state-contracts. Change a value here, then open Fieldwork’s Shared state page: Angular reads the same saved record."
      tryThis="Select well 42, enable overlay, then change only the run. The well and comparison mode stay unchanged. Reload the page to read the saved selection."
    >
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Change was not saved</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <LabSection title="Units">
        <DataList>
          <DataRow label="Units">
            <Value value={units} />
          </DataRow>
        </DataList>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => void save(() => setUnits(units === 'metric' ? 'imperial' : 'metric'))}
        >
          Switch units
        </Button>
        <UnitsMirror />
      </LabSection>
      <LabSection title="Selected well">
        <DataList>
          <DataRow label="Well">
            <Value value={selection?.wellId ?? 'No well selected'} />
          </DataRow>
          <DataRow label="Run">
            <Value value={selection?.runId ?? 'No run selected'} />
          </DataRow>
          <DataRow label="Comparison">
            <Value value={selection?.comparisonMode ?? 'No selection'} />
          </DataRow>
          <DataRow label="Well read by route loader">
            <Value value={loadedSelection?.wellId ?? 'No well selected'} />
          </DataRow>
        </DataList>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={pending}
            onClick={() => void save(() => setSelection({ wellId: 'well-42', runId: 'run-7' }))}
          >
            Select well 42
          </Button>
          <Button
            variant="outline"
            disabled={pending || selection === null}
            onClick={() => void save(() => setSelection({ comparisonMode: 'overlay' }))}
          >
            Enable overlay
          </Button>
          <Button
            variant="outline"
            disabled={pending || selection === null}
            onClick={() => void save(() => store.set('well:selection', { runId: 'run-8' }))}
          >
            Change only run
          </Button>
          <Button
            variant="ghost"
            disabled={pending || selection === null}
            onClick={() => void save(() => setSelection(null))}
          >
            Clear selection
          </Button>
        </div>
      </LabSection>
    </LabPage>
  )
}

function UnitsMirror(): ReactNode {
  const [units] = useSharedState('display:units')
  return <p aria-live="polite">Another subscriber reads {units} units.</p>
}
