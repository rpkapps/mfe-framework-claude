/**
 * Three levels on one page: a React host places an Angular App, and that App places a React Widget
 * with `<mfe-widget>`. Each level mounts the next through the neutral contract, so depth, events
 * and teardown have to carry across both framework boundaries, and disposing the outermost host
 * has to leave nothing of any level behind.
 */

import { ChangeDetectionStrategy, Component, signal } from '@angular/core'
import {
  createApp,
  injectCommand,
  injectMfeMount,
  MfeWidgetComponent,
  type MfeWidgetEvent,
} from '@company/mfe-angular'
import { SCOPE_ATTRIBUTE } from '@company/mfe-angular/host'
import { AppHost, createWidget, useCommand } from '@company/mfe-react'
import { renderSuspending } from '@company/mfe-react/testing'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { createElement as h, useEffect, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'

import {
  applicationCensus,
  createPageRuntime,
  overlayRootCount,
  reactHostPage,
} from './__tests__/harness.ts'

const applications = applicationCensus()

/** How many React Widget roots are mounted right now, reset before every test. */
const seen = { liveWidgets: 0 }

beforeEach(() => {
  seen.liveWidgets = 0
})

const counterContract = {
  inputs: z.object({ label: z.string(), count: z.number() }),
  events: { bumped: z.object({ count: z.number() }) },
}

const counter = createWidget({
  id: 'counter',
  version: '2.0.0',
  ...counterContract,
  render: function Counter({ inputs, emit }): ReactNode {
    useCommand({ name: 'reset', label: 'Reset the counter', execute: () => undefined })
    useEffect(() => {
      seen.liveWidgets += 1
      return () => {
        seen.liveWidgets -= 1
      }
    }, [])

    return h(
      'button',
      {
        type: 'button',
        onClick: () => {
          emit('bumped', { count: inputs.count + 1 })
        },
      },
      `${inputs.label}: ${String(inputs.count)}`,
    )
  },
})

@Component({
  selector: 'interop-workbench',
  imports: [MfeWidgetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<h1>Workbench at depth {{ depth }}</h1>
    <mfe-widget widgetId="counter" [inputs]="counterInputs()" (event)="received($event)" />
    <p>{{ lastEvent() }}</p>`,
})
class WorkbenchComponent {
  readonly depth = injectMfeMount().depth
  readonly counterInputs = signal({ label: 'Nested', count: 1 })
  readonly lastEvent = signal('no event yet')

  constructor() {
    injectCommand({ name: 'refresh', label: 'Refresh the workbench', execute: () => undefined })
  }

  /** Hands the Widget's own count back to it, so the event crosses down as well as up. */
  received(event: MfeWidgetEvent): void {
    const { count } = counterContract.events.bumped.parse(event.payload)
    this.lastEvent.set(`${event.name} to ${String(count)}`)
    this.counterInputs.set({ label: 'Nested', count })
  }
}

const workbenchApp = createApp({
  id: 'workbench',
  version: '0.9.0',
  routes: [{ path: '', component: WorkbenchComponent }],
  providers: [applications.providers],
})

async function renderThreeLevels() {
  const memory = createPageRuntime({
    definitions: [workbenchApp, counter],
    initialEntries: ['/workbench'],
  })
  const widgetMounts = vi.spyOn(counter, 'mount')
  onTestFinished(() => {
    widgetMounts.mockRestore()
  })

  const view = await renderSuspending(
    reactHostPage(memory.runtime, h(AppHost, { appId: 'workbench', basePath: '/workbench' })),
  )
  await screen.findByRole('button', { name: 'Nested: 1' })
  return { memory, view, widgetMounts }
}

describe('a React Widget inside an Angular App inside a React host', () => {
  it('renders every level, one level deeper each time', async () => {
    const { widgetMounts } = await renderThreeLevels()

    expect(screen.getByRole('heading', { name: 'Workbench at depth 1' })).toBeInTheDocument()
    expect(widgetMounts).toHaveBeenCalledTimes(1)
    expect(widgetMounts.mock.calls[0]?.[0].context).toMatchObject({
      definitionId: 'counter',
      kind: 'widget',
      depth: 2,
    })

    const button = screen.getByRole('button', { name: 'Nested: 1' })
    expect(button.closest(`[${SCOPE_ATTRIBUTE}]`)?.getAttribute(SCOPE_ATTRIBUTE)).toBe('counter')
    expect(button.parentElement?.closest(`[${SCOPE_ATTRIBUTE}="workbench"]`)).not.toBeNull()
  })

  it('delivers the React Widget’s events to the Angular App, and the App’s answer back down', async () => {
    await renderThreeLevels()

    fireEvent.click(screen.getByRole('button', { name: 'Nested: 1' }))

    await screen.findByText('bumped to 2')
    await screen.findByRole('button', { name: 'Nested: 2' })
  })

  it('leaves nothing of any level behind once the outer React host is disposed', async () => {
    const { memory, view } = await renderThreeLevels()
    const { runtime } = memory
    expect(applications.live).toBe(1)
    expect(seen.liveWidgets).toBe(1)
    expect(overlayRootCount()).toBe(2)
    await waitFor(() => {
      expect(runtime.commands.size).toBe(2)
    })
    expect(runtime.navigator.blockerCount).toBe(1)
    expect(runtime.breadcrumbs.contributionCount).toBe(1)

    view.unmount()

    await waitFor(() => {
      expect(applications.live).toBe(0)
    })
    await waitFor(() => {
      expect(seen.liveWidgets).toBe(0)
    })
    expect(overlayRootCount()).toBe(0)
    expect(runtime.commands.size).toBe(0)
    expect(runtime.navigator.blockerCount).toBe(0)
    expect(runtime.breadcrumbs.contributionCount).toBe(0)
    expect(runtime.shellState.fieldListenerCount('theme')).toBe(0)
    expect(document.querySelector(`[${SCOPE_ATTRIBUTE}]`)).toBeNull()
  })
})
