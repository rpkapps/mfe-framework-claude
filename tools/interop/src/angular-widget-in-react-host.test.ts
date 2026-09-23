/**
 * A real Angular Widget placed by a React host. The React host renders the scope root and an empty
 * element inside it; the Angular definition creates an application of its own there. Everything a
 * React consumer relies on — inputs, handlers, its own contract, the fallback and disposal — has to
 * behave as it does for a React Widget.
 */

import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  EventEmitter,
  inject,
  Input,
  Output,
  type OnChanges,
  type SimpleChanges,
} from '@angular/core'
import { createWidget } from '@company/mfe-angular'
import {
  KIND_ATTRIBUTE,
  MOUNT_ATTRIBUTE,
  OVERLAY_ROOT_ATTRIBUTE,
  SCOPE_ATTRIBUTE,
} from '@company/mfe-runtime'
import { DynamicWidget, lazyWidget, type WidgetFallbackProps } from '@company/mfe-react'
import { renderSuspending } from '@company/mfe-react/testing'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { createElement as h, useState, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import {
  applicationCensus,
  createPageRuntime,
  overlayRootCount,
  reactHostPage,
} from './__tests__/harness.ts'

const applications = applicationCensus()

/** What the Angular component went through, reset before every test. */
const seen = { created: 0, destroyed: 0, changes: [] as string[][] }

beforeEach(() => {
  seen.created = 0
  seen.destroyed = 0
  seen.changes = []
})

@Component({
  selector: 'interop-alert-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<p>{{ label }}</p>
    <button type="button" (click)="acknowledge()">Acknowledge</button>`,
})
class AlertPanelComponent implements OnChanges {
  @Input() label = ''
  @Input() alertId = ''
  /** Also carries a field the contract does not declare, which the provider's validation strips. */
  @Output() readonly acknowledged = new EventEmitter<{ alertId: string; note: string }>()

  constructor() {
    seen.created += 1
    inject(DestroyRef).onDestroy(() => {
      seen.destroyed += 1
    })
  }

  ngOnChanges(changes: SimpleChanges): void {
    seen.changes.push(Object.keys(changes).sort())
  }

  acknowledge(): void {
    this.acknowledged.emit({ alertId: this.alertId, note: 'not part of the contract' })
  }
}

const alertPanelContract = {
  inputs: z.object({ label: z.string(), alertId: z.string() }),
  events: { acknowledged: z.object({ alertId: z.string() }) },
}

const alertPanel = createWidget({
  id: 'alert-panel',
  version: '1.4.0',
  ...alertPanelContract,
  component: AlertPanelComponent,
  providers: [applications.providers],
})

/** A consumer whose own contract is stricter about ids than the provider's. */
const StrictAlertPanel = lazyWidget('alert-panel', {
  contract: {
    inputs: alertPanelContract.inputs,
    events: { acknowledged: z.object({ alertId: z.string().startsWith('alert-') }) },
  },
})

interface AlertPanelProps {
  readonly label: string
  readonly alertId: string
  readonly onAcknowledged?: (payload: { readonly alertId: string }) => void
}

/** The two ways a React host places a Widget; every behaviour below holds for both. */
const placements: readonly (readonly [string, (props: AlertPanelProps) => ReactNode])[] = [
  ['DynamicWidget', props => h(DynamicWidget, { widgetId: 'alert-panel', ...props })],
  ['lazyWidget with a consumer contract', props => h(StrictAlertPanel, props)],
]

describe.each(placements)('an Angular Widget placed by %s', (_placement, place) => {
  it('renders inside a scope root carrying the Angular Widget’s id', async () => {
    const memory = createPageRuntime({ definitions: [alertPanel] })

    await renderSuspending(
      reactHostPage(memory.runtime, place({ label: 'Disk full', alertId: 'alert-1' })),
    )

    const label = await screen.findByText('Disk full')
    const scope = label.closest(`[${SCOPE_ATTRIBUTE}]`)
    expect(scope?.getAttribute(SCOPE_ATTRIBUTE)).toBe('alert-panel')
    expect(scope?.getAttribute(KIND_ATTRIBUTE)).toBe('widget')
    const overlay = document.querySelector(`[${OVERLAY_ROOT_ATTRIBUTE}]`)
    expect(overlay?.getAttribute(MOUNT_ATTRIBUTE)).toBe(scope?.getAttribute(MOUNT_ATTRIBUTE))
    expect(applications.live).toBe(1)
  })

  it('hands the Angular component an input only when it actually changed', async () => {
    const memory = createPageRuntime({ definitions: [alertPanel] })
    const page = (props: AlertPanelProps): ReactNode => reactHostPage(memory.runtime, place(props))
    const view = await renderSuspending(page({ label: 'Disk full', alertId: 'alert-1' }))
    await screen.findByText('Disk full')
    expect(seen.changes).toEqual([['alertId', 'label']])

    // Equal inputs in a new object, then a new handler: nothing for the Angular component to do.
    view.rerender(page({ label: 'Disk full', alertId: 'alert-1' }))
    view.rerender(page({ label: 'Disk full', alertId: 'alert-1', onAcknowledged: vi.fn() }))
    expect(seen.changes).toHaveLength(1)

    view.rerender(page({ label: 'Disk cleared', alertId: 'alert-1' }))

    await screen.findByText('Disk cleared')
    expect(seen.changes).toEqual([['alertId', 'label'], ['label']])
    expect(seen.created).toBe(1)
    expect(applications.live).toBe(1)
  })

  it('delivers an Angular output to the React onX handler, validated', async () => {
    const memory = createPageRuntime({ definitions: [alertPanel] })
    const onAcknowledged = vi.fn()
    await renderSuspending(
      reactHostPage(
        memory.runtime,
        place({ label: 'Disk full', alertId: 'alert-1', onAcknowledged }),
      ),
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Acknowledge' }))

    expect(onAcknowledged.mock.calls).toEqual([[{ alertId: 'alert-1' }]])
    expect(memory.diagnostics).toEqual([])
  })

  it('destroys the Angular application and removes the overlay root when it unmounts', async () => {
    const memory = createPageRuntime({ definitions: [alertPanel] })
    const view = await renderSuspending(
      reactHostPage(memory.runtime, place({ label: 'Disk full', alertId: 'alert-1' })),
    )
    await screen.findByText('Disk full')
    expect(overlayRootCount()).toBe(1)

    view.unmount()

    await waitFor(() => {
      expect(applications.live).toBe(0)
    })
    expect(seen.destroyed).toBe(1)
    expect(overlayRootCount()).toBe(0)
    expect(screen.queryByText('Disk full')).not.toBeInTheDocument()
  })
})

describe('an Angular Widget’s events in a React host', () => {
  it('reach the onEvent catch-all beside the onX handler, with the validated payload', async () => {
    const memory = createPageRuntime({ definitions: [alertPanel] })
    const onAcknowledged = vi.fn()
    const onEvent = vi.fn()
    await renderSuspending(
      reactHostPage(
        memory.runtime,
        h(DynamicWidget, {
          widgetId: 'alert-panel',
          label: 'Disk full',
          alertId: 'a-1',
          onAcknowledged,
          onEvent,
        }),
      ),
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Acknowledge' }))

    expect(onAcknowledged.mock.calls).toEqual([[{ alertId: 'a-1' }]])
    expect(onEvent.mock.calls).toEqual([['acknowledged', { alertId: 'a-1' }]])
  })

  /** The mismatch is the consumer's to fix, so it is reported and never thrown at the Widget. */
  it('are reported, not delivered, when the consumer’s own contract rejects them', async () => {
    const memory = createPageRuntime({ definitions: [alertPanel] })
    const onAcknowledged = vi.fn()
    const page = (alertId: string): ReactNode =>
      reactHostPage(
        memory.runtime,
        h(StrictAlertPanel, { label: 'Disk full', alertId, onAcknowledged }),
      )
    const view = await renderSuspending(page('a-1'))

    fireEvent.click(await screen.findByRole('button', { name: 'Acknowledge' }))

    expect(onAcknowledged).not.toHaveBeenCalled()
    expect(memory.diagnostics.map(diagnostic => diagnostic.error)).toEqual([
      expect.objectContaining({ code: 'contract/event-mismatch', id: 'alert-panel' }),
    ])

    view.rerender(page('alert-2'))
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' }))

    expect(onAcknowledged.mock.calls).toEqual([[{ alertId: 'alert-2' }]])
    expect(memory.diagnostics).toHaveLength(1)
  })
})

describe('an Angular Widget given invalid first inputs by a React host', () => {
  it('shows the React fallback, and mounts afresh when retried with valid ones', async () => {
    const memory = createPageRuntime({ definitions: [alertPanel] })

    function Consumer(): ReactNode {
      const [label, setLabel] = useState<unknown>(7)
      const fallback = ({ error, retry }: WidgetFallbackProps): ReactNode =>
        h(
          'div',
          null,
          h('p', { 'data-testid': 'failure' }, `${error.code}: ${error.message}`),
          h(
            'button',
            {
              type: 'button',
              onClick: () => {
                setLabel('Disk full')
                retry()
              },
            },
            'Correct and retry',
          ),
        )
      return h(DynamicWidget, { widgetId: 'alert-panel', label, alertId: 'a-1', fallback })
    }

    await renderSuspending(reactHostPage(memory.runtime, h(Consumer)))

    const failure = await screen.findByTestId('failure')
    expect(failure).toHaveTextContent(/^contract\/input-mismatch: alert-panel@1\.4\.0/)
    expect(failure).toHaveTextContent('label')
    // The Widget refused its inputs before creating anything.
    expect(seen.created).toBe(0)
    expect(applications.live).toBe(0)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Correct and retry' }))
      await Promise.resolve()
    })

    await screen.findByText('Disk full')
    expect(screen.queryByTestId('failure')).not.toBeInTheDocument()
    expect(seen.created).toBe(1)
    expect(applications.live).toBe(1)
  })
})
