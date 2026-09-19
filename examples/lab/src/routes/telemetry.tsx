import { createFileRoute } from '@tanstack/react-router'
import { SpanStatusCode, useTelemetry } from '@company/mfe-react'
import { Button } from '@tecton/react/components/button'
import { useState, type ReactNode } from 'react'

import { EventLog, LabPage, LabSection, type LogTone } from '../lab-page.tsx'

export const Route = createFileRoute('/telemetry')({
  staticData: { breadcrumb: 'Telemetry' },
  component: Telemetry,
})

function Telemetry(): ReactNode {
  const telemetry = useTelemetry()
  const [log, setLog] = useState<readonly { at: string; text: string; tone: LogTone }[]>([])

  const note = (text: string, tone: LogTone = 'default'): void => {
    setLog(current =>
      [{ at: new Date().toLocaleTimeString(), text, tone }, ...current].slice(0, 10),
    )
  }

  return (
    <LabPage
      eyebrow="Telemetry"
      title="Spans and logs, already attributed"
      description="Every span this App starts carries the definition id, the version and the mount — the shell's provider adds nothing and an author writes no attribution. The provider decides where a finished span goes; the span implementation is the framework's in both cases."
      tryThis={
        <>
          Start a span, then open the browser console. This shell has no collector configured, so it
          uses the recording provider — the same seam Faro plugs into, which is the point of having
          a seam.
        </>
      }
    >
      <LabSection title="A span around some work" note="tracer.startActiveSpan">
        <div className="flex flex-wrap gap-2">
          <Button
            onPress={() => {
              telemetry.tracer.startActiveSpan('lab.compute', span => {
                span.setAttribute('lab.rows', 128)
                span.setStatus({ code: SpanStatusCode.OK })
                span.end()
                note('Span lab.compute ended OK', 'success')
              })
            }}
          >
            Start a span
          </Button>
          <Button
            variant="outline"
            onPress={() => {
              telemetry.tracer.startActiveSpan('lab.failing', span => {
                span.setStatus({ code: SpanStatusCode.ERROR, message: 'Deliberate failure' })
                span.end()
                note('Span lab.failing ended ERROR', 'destructive')
              })
            }}
          >
            Start a failing span
          </Button>
        </div>
      </LabSection>

      <LabSection title="Structured logging" note="telemetry.debug / info / warn">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onPress={() => {
              telemetry.info('Lab said hello', { where: 'telemetry page' })
              note('info — Lab said hello')
            }}
          >
            Log info
          </Button>
          <Button
            variant="outline"
            onPress={() => {
              telemetry.warn('Lab is about to do something odd', { deliberate: true })
              note('warn — Lab is about to do something odd', 'warning')
            }}
          >
            Log a warning
          </Button>
        </div>
      </LabSection>

      <LabSection title="What this page emitted" note="recorded here, not sent">
        <EventLog
          entries={log}
          empty="Nothing yet. Start a span or log a line, and it is recorded here as well as handed to the provider."
        />
      </LabSection>
    </LabPage>
  )
}
