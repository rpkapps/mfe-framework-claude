import {
  Component,
  EventEmitter,
  Input,
  Output,
  signal,
  ViewChild,
  type ApplicationRef,
} from '@angular/core'
import { DEFINITION_BRAND, type MfeError, type WidgetContract } from '@company/mfe-core'
import type { MountableWidgetDefinition, WidgetMountTarget } from '@company/mfe-runtime'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createHostApplication, renderInHost, type RenderedHost } from '../__tests__/harness.ts'
import { createWidget } from '../definition.ts'
import { createMfeTestEnvironment, type MfeTestEnvironment } from '../testing/index.ts'
import { MfeWidgetComponent, type MfeWidgetEvent } from './widget.component.ts'

@Component({
  selector: 'test-alert',
  template: '<p>{{ alertId }}</p><button (click)="acknowledged.emit({ alertId })">ack</button>',
})
class AlertComponent {
  @Input() alertId = ''
  @Output() readonly acknowledged = new EventEmitter<unknown>()
}

const alertWidget = createWidget({
  id: 'alert-panel',
  inputs: z.object({ alertId: z.string() }),
  events: { acknowledged: z.object({ alertId: z.string() }) },
  component: AlertComponent,
})

/** A definition another adapter built: only the neutral contract, recording what the host did. */
function foreignWidget(id: string, options: { readonly failFirstMount?: boolean } = {}) {
  const calls = {
    targets: [] as WidgetMountTarget[],
    updates: [] as Readonly<Record<string, unknown>>[],
    disposals: 0,
  }
  let attempts = 0

  const definition: MountableWidgetDefinition = {
    [DEFINITION_BRAND]: true,
    kind: 'widget',
    framework: 'react',
    id,
    contract: {
      inputs: z.object({ count: z.number() }),
      events: { clicked: z.object({ count: z.number() }) },
    },
    mount: target => {
      attempts += 1
      if (options.failFirstMount === true && attempts === 1) {
        return Promise.reject(new Error('the first mount fails'))
      }
      calls.targets.push(target)
      target.element.textContent = `count ${String(target.inputs['count'])}`
      return Promise.resolve({
        update: inputs => {
          calls.updates.push(inputs)
          target.element.textContent = `count ${String(inputs['count'])}`
        },
        dispose: () => {
          calls.disposals += 1
          target.element.textContent = ''
          return Promise.resolve()
        },
      })
    },
  }

  return { definition, calls }
}

@Component({
  selector: 'test-host',
  imports: [MfeWidgetComponent],
  template: `
    <mfe-widget
      #widget
      [widgetId]="widgetId()"
      [inputs]="inputs()"
      [contract]="contract"
      [pending]="loading"
      (event)="events.push($event)"
      (failed)="failures.push($event)"
    />
    <ng-template #loading><span class="pending">loading</span></ng-template>
  `,
})
class HostComponent {
  readonly widgetId = signal('alert-panel')
  readonly inputs = signal<Readonly<Record<string, unknown>>>({ alertId: 'a-1' })
  contract: WidgetContract | undefined = undefined
  readonly events: MfeWidgetEvent[] = []
  readonly failures: MfeError[] = []
  @ViewChild('widget') widget: MfeWidgetComponent | undefined
}

async function renderHost(
  definitions: readonly MountableWidgetDefinition[],
  setup: (host: HostComponent) => void = () => undefined,
): Promise<{
  environment: MfeTestEnvironment
  appRef: ApplicationRef
  rendered: RenderedHost<HostComponent>
}> {
  const environment = createMfeTestEnvironment({ definitions })
  const appRef = await createHostApplication(environment)
  const rendered = await renderInHost(appRef, HostComponent, setup)
  return { environment, appRef, rendered }
}

describe('<mfe-widget>', () => {
  it('mounts an Angular Widget by id inside a scope root of its own', async () => {
    const { rendered } = await renderHost([alertWidget])

    await vi.waitFor(() => {
      expect(rendered.element.querySelector('p')?.textContent).toBe('a-1')
    })
    const scope = rendered.element.querySelector('[data-mfe-scope]')
    expect(scope?.getAttribute('data-mfe-scope')).toBe('alert-panel')
    expect(scope?.getAttribute('data-mfe-kind')).toBe('widget')
    expect(scope?.contains(rendered.element.querySelector('p'))).toBe(true)
  })

  it('shows the pending template until the Widget has mounted', async () => {
    const { rendered, appRef } = await renderHost([alertWidget])

    expect(rendered.element.querySelector('.pending')).not.toBeNull()
    await vi.waitFor(() => {
      expect(rendered.element.querySelector('p')).not.toBeNull()
    })
    await appRef.whenStable()
    expect(rendered.element.querySelector('.pending')).toBeNull()
  })

  it('feeds new inputs to the mounted Widget and delivers its events', async () => {
    const { rendered, appRef } = await renderHost([alertWidget])
    await vi.waitFor(() => {
      expect(rendered.element.querySelector('p')?.textContent).toBe('a-1')
    })

    rendered.ref.instance.inputs.set({ alertId: 'a-2' })
    await appRef.whenStable()
    await vi.waitFor(() => {
      expect(rendered.element.querySelector('p')?.textContent).toBe('a-2')
    })
    rendered.element.querySelector('button')?.click()

    expect(rendered.ref.instance.events).toEqual([
      { name: 'acknowledged', payload: { alertId: 'a-2' } },
    ])
  })

  it('reports first inputs the Widget refuses through its failed output', async () => {
    const { rendered } = await renderHost([alertWidget], host => {
      host.inputs.set({ alertId: 7 })
    })

    await vi.waitFor(() => {
      expect(rendered.ref.instance.failures).toHaveLength(1)
    })
    expect(rendered.ref.instance.failures[0]?.code).toBe('contract/input-mismatch')
    expect(rendered.element.querySelector('[data-mfe-scope]')).toBeNull()
  })

  describe('hosting a definition another adapter built', () => {
    it('hands it an element inside the scope root, its inputs and their updates', async () => {
      const { definition, calls } = foreignWidget('counter')
      const { rendered, appRef } = await renderHost([definition], host => {
        host.widgetId.set('counter')
        host.inputs.set({ count: 1 })
      })

      await vi.waitFor(() => {
        expect(calls.targets).toHaveLength(1)
      })
      const target = calls.targets[0]
      expect(target?.element.parentElement?.getAttribute('data-mfe-scope')).toBe('counter')
      expect(target?.context.definitionId).toBe('counter')
      expect(target?.context.kind).toBe('widget')
      expect(rendered.element.textContent).toContain('count 1')

      rendered.ref.instance.inputs.set({ count: 2 })
      await appRef.whenStable()

      expect(calls.updates).toEqual([{ count: 2 }])
      expect(rendered.element.textContent).toContain('count 2')
    })

    it('routes what it emits to the event output, checking the host’s own contract', async () => {
      const { definition, calls } = foreignWidget('counter')
      const { rendered, environment } = await renderHost([definition], host => {
        host.widgetId.set('counter')
        host.inputs.set({ count: 1 })
        host.contract = {
          inputs: z.object({ count: z.number() }),
          events: { clicked: z.object({ count: z.number().max(5) }) },
        }
      })
      await vi.waitFor(() => {
        expect(calls.targets).toHaveLength(1)
      })

      calls.targets[0]?.emit('clicked', { count: 3 })
      calls.targets[0]?.emit('clicked', { count: 9 })

      expect(rendered.ref.instance.events).toEqual([{ name: 'clicked', payload: { count: 3 } }])
      expect(environment.diagnostics.map(({ error }) => error.code)).toEqual([
        'contract/event-mismatch',
      ])
    })

    it('disposes the mount, its context and its scope root when the host is destroyed', async () => {
      const { definition, calls } = foreignWidget('counter')
      const { rendered, appRef } = await renderHost([definition], host => {
        host.widgetId.set('counter')
        host.inputs.set({ count: 1 })
      })
      await vi.waitFor(() => {
        expect(calls.targets).toHaveLength(1)
      })
      const context = calls.targets[0]?.context

      rendered.ref.destroy()
      await appRef.whenStable()
      await vi.waitFor(() => {
        expect(calls.disposals).toBe(1)
      })

      expect(context?.signal.aborted).toBe(true)
      expect(context?.overlayRoot.isConnected).toBe(false)
      expect(document.querySelector('[data-mfe-scope="counter"]')).toBeNull()
    })

    it('replaces the mount when the id changes', async () => {
      const first = foreignWidget('first')
      const second = foreignWidget('second')
      const { rendered, appRef } = await renderHost([first.definition, second.definition], host => {
        host.widgetId.set('first')
        host.inputs.set({ count: 1 })
      })
      await vi.waitFor(() => {
        expect(first.calls.targets).toHaveLength(1)
      })

      rendered.ref.instance.widgetId.set('second')
      await appRef.whenStable()

      await vi.waitFor(() => {
        expect(second.calls.targets).toHaveLength(1)
      })
      expect(first.calls.disposals).toBe(1)
      expect(first.calls.updates).toEqual([])
    })

    it('reports a failed mount and mounts afresh on retry', async () => {
      const { definition, calls } = foreignWidget('flaky', { failFirstMount: true })
      const { rendered } = await renderHost([definition], host => {
        host.widgetId.set('flaky')
        host.inputs.set({ count: 1 })
      })
      await vi.waitFor(() => {
        expect(rendered.ref.instance.failures).toHaveLength(1)
      })
      expect(rendered.ref.instance.failures[0]?.message).toContain('the first mount fails')

      rendered.ref.instance.widget?.retry()

      await vi.waitFor(() => {
        expect(calls.targets).toHaveLength(1)
      })
      expect(rendered.element.textContent).toContain('count 1')
    })
  })

  it('reports an id the registry does not know, once', async () => {
    const { rendered, environment } = await renderHost([], host => {
      host.widgetId.set('missing')
    })

    await vi.waitFor(() => {
      expect(rendered.ref.instance.failures).toHaveLength(1)
    })
    expect(rendered.ref.instance.failures[0]?.code).toBe('registry/invalid-entry')
    expect(environment.diagnostics).toHaveLength(1)
  })
})
