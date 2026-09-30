/** Framework protections must hold when provider and host use different adapters. */
import {
  ChangeDetectionStrategy,
  Component,
  Input,
  provideEnvironmentInitializer,
} from '@angular/core'
import { createWidget as createAngularWidget } from '@company/mfe-angular'
import { createWidget, DynamicWidget, lazyWidget } from '@company/mfe-react'
import { renderSuspending } from '@company/mfe-react/testing'
import { screen, waitFor } from '@testing-library/react'
import { createElement as h } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createPageRuntime, reactHostPage } from './__tests__/harness.ts'

@Component({
  selector: 'resilience-value',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<p>Value {{ value }}</p>',
})
class ValueComponent {
  @Input() value = 0
}

const valueContract = { inputSchema: z.object({ value: z.number() }), outputSchema: z.object({}) }
const bad = createWidget({
  id: 'future-widget',
  ...valueContract,
  render: () => h('p', null, 'Future feature'),
})
const good = createWidget({
  id: 'current-widget',
  ...valueContract,
  render: () => h('p', null, 'Current feature'),
})
const created = vi.fn()
const changedWidget = createAngularWidget({
  id: 'changed-angular-widget',
  ...valueContract,
  component: ValueComponent,
  providers: [provideEnvironmentInitializer(created)],
})
const ChangedWidget = lazyWidget(changedWidget.id, {
  contract: { ...valueContract, outputSchema: z.object({ removed: z.string() }) },
})
const valueWidget = createAngularWidget({
  id: 'angular-value-widget',
  ...valueContract,
  component: ValueComponent,
})

describe('mixed-release and cross-framework boundaries', () => {
  it('rejects an incompatible runtime before download while a sibling still renders', async () => {
    const memory = createPageRuntime({ definitions: [bad, good] })
    const entries = new Map(memory.runtime.registry.entries)
    entries.set(bad.id, { ...entries.get(bad.id)!, requiresRuntime: '>=2.0.0 <3.0.0' })
    const runtime = { ...memory.runtime, registry: { ...memory.runtime.registry, entries } }
    const load = vi.spyOn(runtime.loader, 'load')

    await renderSuspending(
      reactHostPage(
        runtime,
        h(
          'div',
          null,
          h(DynamicWidget, { widgetId: bad.id, value: 1 }),
          h(DynamicWidget, { widgetId: good.id, value: 1 }),
        ),
      ),
    )
    await screen.findByText('Current feature')
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveAttribute(
        'data-mfe-error',
        'contract/runtime-incompatible',
      ),
    )
    expect(load.mock.calls.map(([entry]) => entry.id)).toEqual([good.id])
    expect(screen.queryByText('Future feature')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('rejects a removed Angular output before creating its application', async () => {
    const memory = createPageRuntime({ definitions: [changedWidget] })
    await renderSuspending(reactHostPage(memory.runtime, h(ChangedWidget, { value: 1 })))
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveAttribute(
        'data-mfe-error',
        'contract/incompatible-widget',
      ),
    )
    expect(created).not.toHaveBeenCalled()
    expect(screen.queryByText('Value 1')).toBeNull()
  })

  it('reports rejected Angular updates in a React host, then clears the stale-input indication', async () => {
    const memory = createPageRuntime({ definitions: [valueWidget] })
    const rejected = vi.fn()
    const page = (value: unknown) =>
      reactHostPage(
        memory.runtime,
        h(DynamicWidget, { widgetId: valueWidget.id, value, onInputRejected: rejected }),
      )
    const view = await renderSuspending(page(1))
    await screen.findByText('Value 1')
    view.rerender(page('invalid'))
    await waitFor(() => expect(rejected).toHaveBeenCalledTimes(1))
    expect(screen.getByText('Value 1')).toBeInTheDocument()
    expect(document.querySelector('[data-mfe-input-rejected]')).not.toBeNull()
    view.rerender(page(2))
    await screen.findByText('Value 2')
    await waitFor(() => expect(document.querySelector('[data-mfe-input-rejected]')).toBeNull())
    expect(rejected).toHaveBeenCalledTimes(1)
  })
})
