/**
 * Three levels on one page: a React host places an Angular App, and that App places a React Widget
 * with `<mfe-widget>`. Each level mounts the next through the neutral contract, so depth, events
 * and teardown have to carry across both framework boundaries, and disposing the outermost host
 * has to leave nothing of any level behind.
 */

import { ChangeDetectionStrategy, Component, signal } from '@angular/core'
import {
  createApp,
  injectAction,
  injectMfeMount,
  MfeWidgetComponent,
  type MfeWidgetOutput,
} from '@company/mfe-angular'
import { AppHost } from '@company/mfe-react'
import { renderSuspending } from '@company/mfe-react/testing'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { createElement as h } from 'react'
import { describe, expect, it, onTestFinished, vi } from 'vitest'

import {
  applicationCensus,
  createPageRuntime,
  expectedScope,
  expectReleased,
  overlayRootCount,
  reactHostPage,
  scopesAround,
} from './__tests__/harness.ts'
import { counter, counterContract, counterRoots } from './fixtures/counter.ts'

const applications = applicationCensus()

@Component({
  selector: 'interop-workbench',
  imports: [MfeWidgetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<h1>Workbench at depth {{ depth }}</h1>
    <mfe-widget widgetId="counter" [inputs]="counterInputs()" (output)="received($event)" />
    <p>{{ lastEvent() }}</p>`,
})
class WorkbenchComponent {
  readonly depth = injectMfeMount().depth
  readonly counterInputs = signal({ label: 'Nested', count: 1 })
  readonly lastEvent = signal('no event yet')

  constructor() {
    injectAction({ name: 'refresh', label: 'Refresh the workbench', execute: () => undefined })
  }

  /** Hands the Widget's own count back to it, so the output crosses down as well as up. */
  received(event: MfeWidgetOutput): void {
    const { count } = counterContract.outputSchema.shape.bumped.parse(event.payload)
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

    // The React host is no mount, so the Widget sits in the App's scope and in nothing else.
    expect(scopesAround(screen.getByRole('button', { name: 'Nested: 1' }))).toEqual([
      expectedScope('counter', 'widget'),
      expectedScope('workbench', 'app'),
    ])
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
    expect(counterRoots.live).toBe(1)
    expect(overlayRootCount()).toBe(2)
    await waitFor(() => {
      expect(runtime.actions.size).toBe(2)
    })
    expect(runtime.navigator.blockerCount).toBe(1)
    expect(runtime.breadcrumbs.contributionCount).toBe(1)

    view.unmount()

    await waitFor(() => {
      expect(applications.live).toBe(0)
    })
    await waitFor(() => {
      expect(counterRoots.live).toBe(0)
    })
    expectReleased(runtime)
  })
})
