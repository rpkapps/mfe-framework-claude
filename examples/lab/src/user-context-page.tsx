import { memo, useId, useState, type ReactNode } from 'react'
import { useLoaderData } from '@tanstack/react-router'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@tecton/react/components/alert'
import { Button } from '@tecton/react/components/button'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@tecton/react/components/empty'
import { Field, FieldLabel } from '@tecton/react/components/field'
import { NativeSelect, NativeSelectOption } from '@tecton/react/components/native-select'
import { Switch } from '@tecton/react/components/switch'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
} from '@tecton/react/components/table'

import { formatDepth, wells } from '@example/user-context-demo/wells'
import { useUserContext } from '#mfe/user-context'

import { WellInspection } from './inspection-widget.ts'
import { LabPage, LabSection, WidgetSkeleton } from './lab-page.tsx'

export function UserContextPage(): ReactNode {
  const id = useId()
  const store = useUserContext()
  const units = store.get('display:units')
  const selection = store.get('well:selection')
  const setUnits = (value: 'metric' | 'imperial') => store.set('display:units', value)
  const setSelection = (value: Parameters<typeof store.set<'well:selection'>>[1]) =>
    store.set('well:selection', value)
  const loadedSelection = useLoaderData({ from: '/user-context' })
  const well = wells.find(candidate => candidate.id === selection?.wellId)
  const [error, setError] = useState('')

  async function save(
    write: () => Promise<{ ok: boolean; error?: { message: string } }>,
  ): Promise<void> {
    try {
      const result = await write()
      if (!result.ok) throw new Error(result.error?.message ?? 'The update failed')
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <LabPage
      eyebrow="User context"
      title="Review a survey. Plan its inspection."
      description="Two independently mounted micro-frontends use the same selection. The React App reviews survey data; the Angular Widget prepares an inspection for that well."
      tryThis="Choose a well on the left and watch the Angular panel update. Change the survey or units in React; Angular reads the updated selection and prepares a local inspection brief. Close and reopen the inspection panel; the selection stays."
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-label="React survey app">
          <LabSection title="Survey review" note="React App · Lab">
            {error && (
              <Alert variant="destructive">
                <AlertTitle>Selection was not saved</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Field>
              <FieldLabel htmlFor={`${id}-well`}>Well</FieldLabel>
              <NativeSelect
                id={`${id}-well`}
                value={well?.id ?? ''}
                onChange={event => {
                  const next = wells.find(candidate => candidate.id === event.target.value)
                  if (next)
                    void save(() =>
                      setSelection({
                        wellId: next.id,
                        runId: next.runs[1].id,
                        comparisonMode: 'baseline',
                      }),
                    )
                }}
              >
                <NativeSelectOption value="">Choose a well</NativeSelectOption>
                {wells.map(option => (
                  <NativeSelectOption key={option.id} value={option.id}>
                    {option.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-run`}>Survey run</FieldLabel>
              <NativeSelect
                id={`${id}-run`}
                value={selection?.runId ?? ''}
                disabled={!well}
                onChange={event => {
                  const runId = event.target.value
                  if (well?.runs.some(run => run.id === runId))
                    void save(() => store.set('well:selection', { runId }))
                }}
              >
                <NativeSelectOption value="">Choose a survey</NativeSelectOption>
                {well?.runs.map(run => (
                  <NativeSelectOption key={run.id} value={run.id}>
                    {run.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-units`}>Depth units</FieldLabel>
              <NativeSelect
                id={`${id}-units`}
                value={units}
                onChange={event => {
                  const nextUnits = event.target.value
                  if (nextUnits === 'metric' || nextUnits === 'imperial')
                    void save(() => setUnits(nextUnits))
                }}
              >
                <NativeSelectOption value="metric">Metres</NativeSelectOption>
                <NativeSelectOption value="imperial">Feet</NativeSelectOption>
              </NativeSelect>
            </Field>
            <Field orientation="horizontal" data-disabled={!well}>
              <Switch
                id={`${id}-comparison`}
                checked={selection?.comparisonMode === 'overlay'}
                disabled={!well}
                onCheckedChange={checked =>
                  void save(() =>
                    setSelection({ comparisonMode: checked ? 'overlay' : 'baseline' }),
                  )
                }
              />
              <FieldLabel htmlFor={`${id}-comparison`}>Compare with baseline</FieldLabel>
            </Field>
            <SurveyResults />
            <Button
              variant="ghost"
              disabled={selection === null}
              onClick={() => void save(() => setSelection(null))}
            >
              Clear selected well
            </Button>
          </LabSection>
        </section>
        <InspectionPlanner />
      </div>
      <details>
        <summary>How the two MFEs share this selection</summary>
        <p>
          Lab declares and owns its user context schema. Fieldwork explicitly reads Lab’s slice; the
          inspection brief stays local to the mounted panel. Each MFE uses generated bindings, and
          cross-MFE reads cannot write the other MFE’s state.
        </p>
        <p>
          The route loader read{' '}
          {wells.find(candidate => candidate.id === loadedSelection?.wellId)?.name ??
            'no selection'}{' '}
          when it last ran.
        </p>
      </details>
    </LabPage>
  )
}

// User-context updates reach Angular through its store subscription, independently of this form.
const InspectionPlanner = memo(function InspectionPanel(): ReactNode {
  const [showInspection, setShowInspection] = useState(true)
  return (
    <section aria-label="Angular inspection app">
      <LabSection title="Inspection planner" note="Angular Widget · Fieldwork">
        <p>
          The planner below is loaded from the Fieldwork container. It receives no well, run or
          units as props.
        </p>
        {showInspection ? (
          <WellInspection
            pending={<WidgetSkeleton />}
            fallback={({ error: failure, retry }) => (
              <Alert variant="destructive">
                <AlertTitle>Inspection planner could not load</AlertTitle>
                <AlertDescription>{failure.message}</AlertDescription>
                <AlertAction>
                  <Button variant="outline" onClick={retry}>
                    Retry inspection planner
                  </Button>
                </AlertAction>
              </Alert>
            )}
          />
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Inspection panel closed</EmptyTitle>
              <EmptyDescription>Reopen it to read the current shared selection.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        <Button variant="outline" onClick={() => setShowInspection(current => !current)}>
          {showInspection ? 'Close inspection panel' : 'Reopen inspection panel'}
        </Button>
      </LabSection>
    </section>
  )
})

function SurveyResults(): ReactNode {
  const store = useUserContext()
  const units = store.get('display:units')
  const selection = store.get('well:selection')
  const well = wells.find(candidate => candidate.id === selection?.wellId)
  const run = well?.runs.find(candidate => candidate.id === selection?.runId)
  if (!well || !run)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No survey selected</EmptyTitle>
          <EmptyDescription>
            Choose a well to review its surveys and prepare an inspection.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  const baseline = well.runs[0]
  return (
    <section aria-label="React survey results" aria-live="polite">
      <h3>{well.name}</h3>
      <p>{well.site}</p>
      <Table>
        <TableCaption>Survey depths</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Survey</TableHead>
            <TableHead>Measured depth</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>{run.name}</TableCell>
            <TableCell>{formatDepth(run.depthMetres, units)}</TableCell>
          </TableRow>
          {selection?.comparisonMode === 'overlay' && run.id !== baseline.id && (
            <TableRow>
              <TableCell>{baseline.name}</TableCell>
              <TableCell>{formatDepth(baseline.depthMetres, units)}</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </section>
  )
}
