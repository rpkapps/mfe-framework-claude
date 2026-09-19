import { createFileRoute } from '@tanstack/react-router'
import { Button } from '@tecton/react/components/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@tecton/react/components/select'
import { Field, FieldDescription, FieldLabel } from '@tecton/react/components/field'
import { Input } from '@tecton/react/components/input'
import { useId, useState, type ReactNode } from 'react'

import { AlertPanel, MissingWidget, UntypedAlertPanel } from '../widgets.ts'
import { LabPage, LabSection, Readout } from '../lab-page.tsx'

export const Route = createFileRoute('/widgets')({
  staticData: { breadcrumb: 'Widgets' },
  component: Widgets,
})

const SEVERITIES = ['info', 'warning', 'critical'] as const

function Widgets(): ReactNode {
  const id = useId()
  const [alertId, setAlertId] = useState('a-1001')
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]>('warning')
  const [badSeverity, setBadSeverity] = useState('critical')
  const [events, setEvents] = useState<readonly string[]>([])
  const [showMissing, setShowMissing] = useState(false)

  const record = (line: string): void => {
    setEvents(current => [line, ...current].slice(0, 8))
  }

  return (
    <LabPage
      eyebrow="Widgets"
      title="Inputs are props, events are onX props"
      description="Every panel below comes from a different container over the network. Consuming one looks like an ordinary lazy component, and the boundary between them is enforced in both directions: inputs are validated going in, event payloads going out."
      tryThis={
        <>
          Change the inputs and watch the Widget update without remounting. Then set the severity to
          something the contract does not declare — the Widget keeps showing its last valid inputs
          and the error names the field, the value and the repair.
        </>
      }
    >
      <LabSection title="A typed consumer" note="with contract">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={`${id}-alert`}>alertId</FieldLabel>
            <Input
              id={`${id}-alert`}
              value={alertId}
              onChange={event => {
                setAlertId(event.target.value)
              }}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-severity`}>severity</FieldLabel>
            <Select
              className="w-full"
              selectedKey={severity}
              onSelectionChange={key => {
                setSeverity(String(key) as (typeof SEVERITIES)[number])
              }}
            >
              <SelectTrigger id={`${id}-severity`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEVERITIES.map(option => (
                  <SelectItem key={option} id={option} textValue={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>Only the declared members are offered.</FieldDescription>
          </Field>
        </div>

        <AlertPanel
          alertId={alertId}
          severity={severity}
          onAcknowledged={event => {
            record(`acknowledged ${event.alertId} at ${event.acknowledgedAt}`)
          }}
          onDismissed={event => {
            record(`dismissed ${event.alertId}`)
          }}
          fallback={({ error, retry }) => (
            <WidgetFailure message={error.message} code={error.code} onRetry={retry} />
          )}
        />

        {events.length === 0 ? null : <Readout label="events received" value={events.join('\n')} />}
      </LabSection>

      <LabSection title="An input the contract rejects" note="provider validation">
        <p className="text-sm text-muted-foreground">
          The provider validates, whatever the consumer believes. The mounted Widget keeps its last
          valid inputs rather than unmounting, and the rejection is reported with the field and the
          repair.
        </p>
        <Field>
          <FieldLabel htmlFor={`${id}-bad`}>severity (unchecked)</FieldLabel>
          <Input
            id={`${id}-bad`}
            value={badSeverity}
            onChange={event => {
              setBadSeverity(event.target.value)
            }}
          />
          <FieldDescription>
            Try <code className="font-mono">critical</code>, then{' '}
            <code className="font-mono">urgent</code>.
          </FieldDescription>
        </Field>

        <UntypedAlertPanel
          alertId="a-2002"
          severity={badSeverity}
          fallback={({ error, retry }) => (
            <WidgetFailure message={error.message} code={error.code} onRetry={retry} />
          )}
        />
      </LabSection>

      <LabSection title="A Widget that is not registered" note="contained failure">
        <p className="text-sm text-muted-foreground">
          The rest of this page keeps working. A Widget that cannot be loaded loses its own box and
          nothing else. It is behind a button because a page that shows an error before you have
          asked for one reads as broken rather than as a demonstration.
        </p>
        {showMissing ? (
          <MissingWidget
            fallback={({ error, retry }) => (
              <WidgetFailure message={error.message} code={error.code} onRetry={retry} />
            )}
          />
        ) : (
          <div>
            <Button
              variant="outline"
              onPress={() => {
                setShowMissing(true)
              }}
            >
              Mount a Widget that does not exist
            </Button>
          </div>
        )}
      </LabSection>
    </LabPage>
  )
}

function WidgetFailure({
  message,
  code,
  onRetry,
}: {
  readonly message: string
  readonly code: string
  readonly onRetry: () => void
}): ReactNode {
  return (
    <div role="alert" className="flex flex-col gap-2 rounded-md border border-destructive/40 p-3">
      <code className="font-mono text-xs text-destructive">{code}</code>
      <p className="text-sm whitespace-pre-wrap text-muted-foreground">{message}</p>
      <div>
        <Button variant="outline" size="sm" onPress={onRetry}>
          Retry
        </Button>
      </div>
    </div>
  )
}
