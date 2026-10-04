import { createFileRoute } from '@tanstack/react-router'
import { fetch } from '#mfe/fetch'
import { useTelemetry } from '@company/mfe-react'
import { Button } from '@tecton/react/components/button'
import { useRef, useState, type ReactNode } from 'react'

import { EventLog, LabPage, LabSection, type LogTone } from '../lab-page.tsx'

export const Route = createFileRoute('/telemetry')({
  staticData: { breadcrumb: 'Telemetry' },
  component: Telemetry,
})

function Telemetry(): ReactNode {
  const telemetry = useTelemetry()
  const checkout = telemetry.workflow('checkout')
  const [log, setLog] = useState<
    readonly { id: number; at: string; text: string; tone: LogTone }[]
  >([])
  const lastEntry = useRef(0)

  const note = (text: string, tone: LogTone = 'default'): void => {
    lastEntry.current += 1
    const entry = { id: lastEntry.current, at: new Date().toLocaleTimeString(), text, tone }
    setLog(current => [entry, ...current].slice(0, 10))
  }

  function start(): void {
    checkout.start({ items: 3 })
    note('checkout started')
  }

  function chooseShipping(option: string): void {
    checkout.step('shipping chosen', { option })
    note(`step — shipping chosen: ${option}`)
  }

  async function placeOrder(): Promise<void> {
    checkout.step('place order')
    try {
      const response = await fetch('lab/orders', { method: 'POST', headers: checkout.headers() })
      if (!response.ok) throw new Error(`Order failed: ${String(response.status)}`)
      checkout.succeed()
      note('checkout succeeded', 'success')
    } catch (error) {
      checkout.fail(error)
      note(
        `checkout failed — ${error instanceof Error ? error.message : String(error)}`,
        'destructive',
      )
    }
  }

  return (
    <LabPage
      eyebrow="Telemetry"
      title="Workflows and logs, already attributed"
      description="A workflow is one trace across clicks and a request: each step is a child of it, and the request joins it through the headers the workflow hands out. Every span and record carries the definition id, the version and the mount — the shell's provider adds nothing and an author writes no attribution."
      tryThis={
        <>
          Start the checkout, choose shipping, then place the order. The order goes to the
          development API with the step&apos;s <code className="font-mono">traceparent</code>; with
          no API running the request fails, and the workflow fails with it. The provider decides
          where a finished span goes, so open your collector to see the trace.
        </>
      }
    >
      <LabSection title="A checkout across three clicks" note="telemetry.workflow">
        <div className="flex flex-wrap gap-2">
          <Button onClick={start}>Start checkout</Button>
          <Button variant="outline" onClick={() => chooseShipping('standard')}>
            Standard shipping
          </Button>
          <Button variant="outline" onClick={() => chooseShipping('express')}>
            Express shipping
          </Button>
          <Button variant="outline" onClick={() => void placeOrder()}>
            Place order
          </Button>
        </div>
      </LabSection>

      <LabSection title="Structured logging" note="telemetry.debug / info / warn">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => {
              telemetry.info('Lab said hello', { where: 'telemetry page' })
              note('info — Lab said hello')
            }}
          >
            Log info
          </Button>
          <Button
            variant="outline"
            onClick={() => {
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
          empty="Nothing yet. Start the checkout or log a line, and it is noted here as well as handed to the provider."
        />
      </LabSection>
    </LabPage>
  )
}
