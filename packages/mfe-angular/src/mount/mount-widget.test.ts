import {
  Component,
  DestroyRef,
  EventEmitter,
  inject,
  Input,
  Output,
  provideEnvironmentInitializer,
  type OnInit,
} from '@angular/core'
import { createMountContext } from '@company/mfe-runtime'
import { beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { createWidget } from '../definition.ts'
import { injectBasePath } from '../inject/services.ts'
import { injectMfeMount } from '../inject/runtime.ts'
import { injectWidgetEmit } from '../inject/widget-emit.ts'
import { createMfeTestEnvironment, mountWidget } from '../testing/index.ts'

const alertContract = {
  inputs: z.object({
    alertId: z.string(),
    severity: z.enum(['info', 'critical']).optional(),
  }),
  events: { acknowledged: z.object({ alertId: z.string() }) },
}

let destroyedAlerts = 0

@Component({
  selector: 'test-alert',
  template: `<p>{{ alertId }}:{{ severity }}</p>
    <button (click)="acknowledge()">ack</button>`,
})
class AlertComponent {
  @Input() alertId = ''
  @Input() severity = 'info'
  @Output() readonly acknowledged = new EventEmitter<unknown>()

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      destroyedAlerts += 1
    })
  }

  acknowledge(): void {
    this.acknowledged.emit({ alertId: this.alertId })
  }
}

const alertWidget = createWidget({
  id: 'alert-panel',
  version: '1.4.0',
  ...alertContract,
  component: AlertComponent,
})

// Before, not after: the shared setup disposes a test's leftover mounts after its own hooks run.
beforeEach(() => {
  destroyedAlerts = 0
})

function button(element: HTMLElement): HTMLButtonElement {
  const found = element.querySelector('button')
  if (!found) throw new Error('the Widget rendered no button')
  return found
}

describe('mounting a Widget', () => {
  it('renders its validated inputs inside the scope root the host provides', async () => {
    const widget = await mountWidget(alertWidget, { inputs: { alertId: 'a-1' } })

    expect(widget.element.getAttribute('data-mfe-scope')).toBe('alert-panel')
    expect(widget.element.getAttribute('data-mfe-kind')).toBe('widget')
    expect(widget.element.querySelector('p')?.textContent).toBe('a-1:info')
  })

  it('renders into a child it owns, so disposal leaves the host’s element in place and empty', async () => {
    const widget = await mountWidget(alertWidget, { inputs: { alertId: 'a-1' } })
    const hostElement = widget.element.firstElementChild
    if (!(hostElement instanceof HTMLElement)) throw new Error('no host element')

    await widget.dispose()

    expect(hostElement.isConnected).toBe(false)
    expect(hostElement.childElementCount).toBe(0)
    expect(destroyedAlerts).toBe(1)
  })

  it('sets an accepted input update on the live component rather than remounting it', async () => {
    const widget = await mountWidget(alertWidget, { inputs: { alertId: 'a-1' } })
    const paragraph = widget.element.querySelector('p')

    await widget.update({ alertId: 'a-2', severity: 'critical' })

    expect(widget.element.querySelector('p')).toBe(paragraph)
    expect(paragraph?.textContent).toBe('a-2:critical')
    expect(destroyedAlerts).toBe(0)
  })

  it('does not validate again for an equal input object', async () => {
    let validations = 0
    const counted = createWidget({
      id: 'counted',
      inputs: z.object({
        alertId: z.string().refine(() => {
          validations += 1
          return true
        }),
      }),
      events: alertContract.events,
      component: AlertComponent,
    })
    const widget = await mountWidget(counted, { inputs: { alertId: 'a-1' } })
    expect(validations).toBe(1)

    await widget.update({ alertId: 'a-1' })

    expect(validations).toBe(1)
  })

  it('delivers an output through the Widget’s own contract to the host', async () => {
    const widget = await mountWidget(alertWidget, { inputs: { alertId: 'a-1' } })

    button(widget.element).click()

    expect(widget.events).toEqual([{ name: 'acknowledged', payload: { alertId: 'a-1' } }])
  })

  it('reports an output payload its contract rejects instead of delivering it', async () => {
    @Component({ selector: 'test-broken', template: '' })
    class BrokenComponent implements OnInit {
      @Input() alertId = ''
      @Input() severity = 'info'
      @Output() readonly acknowledged = new EventEmitter<unknown>()

      ngOnInit(): void {
        queueMicrotask(() => {
          this.acknowledged.emit({ alertId: 7 })
        })
      }
    }
    const broken = createWidget({ id: 'broken', ...alertContract, component: BrokenComponent })

    const widget = await mountWidget(broken, { inputs: { alertId: 'a-1' } })
    await widget.whenStable()

    expect(widget.events).toEqual([])
    expect(widget.environment.diagnostics.map(({ error }) => error.code)).toEqual([
      'contract/event-mismatch',
    ])
    expect(widget.environment.diagnostics[0]?.error.message).toContain(
      "broken failed to emit event 'acknowledged' alertId: 7",
    )
  })

  describe('emitting through injectWidgetEmit', () => {
    let emitFromChild: ((event: string, payload: unknown) => void) | null = null

    @Component({ selector: 'test-nested-emitter', template: '' })
    class NestedEmitterComponent {
      constructor() {
        emitFromChild = injectWidgetEmit()
      }
    }

    @Component({
      selector: 'test-emitting-alert',
      imports: [NestedEmitterComponent],
      template: '<test-nested-emitter />',
    })
    class EmittingAlertComponent {
      @Input() alertId = ''
      @Input() severity = 'info'
      @Output() readonly acknowledged = new EventEmitter<unknown>()
    }

    const emitting = createWidget({
      id: 'emitting',
      ...alertContract,
      component: EmittingAlertComponent,
    })

    it('reaches the host from a component nested anywhere in the Widget', async () => {
      const widget = await mountWidget(emitting, { inputs: { alertId: 'a-1' } })

      emitFromChild?.('acknowledged', { alertId: 'nested' })

      expect(widget.events).toEqual([{ name: 'acknowledged', payload: { alertId: 'nested' } }])
    })

    it('throws at the call site for an event the Widget does not declare', async () => {
      await mountWidget(emitting, { inputs: { alertId: 'a-1' } })

      expect(() => emitFromChild?.('dismissed', {})).toThrowError(
        /emitting failed to emit event 'dismissed': expected one of the declared events \(acknowledged\)/,
      )
    })

    it('throws at the call site for a payload the contract rejects', async () => {
      const widget = await mountWidget(emitting, { inputs: { alertId: 'a-1' } })

      expect(() => emitFromChild?.('acknowledged', { alertId: () => 'x' })).toThrowError(
        /expected a JSON-serializable value, received a function/,
      )
      expect(widget.events).toEqual([])
    })
  })

  it('rejects first inputs its contract refuses and leaves nothing behind', async () => {
    const environment = createMfeTestEnvironment()

    await expect(
      mountWidget(alertWidget, { environment, inputs: { alertId: 7 } }),
    ).rejects.toThrowError(/alert-panel@1.4.0 failed to accept input alertId: 7/)

    expect(document.body.childElementCount).toBe(0)
    environment.dispose()
  })

  it('keeps rendering its last valid inputs when a later update is refused', async () => {
    const widget = await mountWidget(alertWidget, { inputs: { alertId: 'a-1' } })

    await widget.update({ alertId: 'a-1', severity: 'catastrophic' })

    expect(widget.element.querySelector('p')?.textContent).toBe('a-1:info')
    expect(widget.rejectedInputs.map(error => error.code)).toEqual(['contract/input-mismatch'])
    expect(widget.environment.diagnostics.map(({ error }) => error.code)).toEqual([
      'contract/input-mismatch',
    ])
  })

  it('provides the mount to everything the Widget creates', async () => {
    let seen: { readonly id: string; readonly basePath: string } | null = null

    @Component({ selector: 'test-probe', template: '' })
    class ProbeComponent {
      constructor() {
        seen = { id: injectMfeMount().definitionId, basePath: injectBasePath() }
      }
    }
    const probe = createWidget({
      id: 'probe',
      inputs: z.object({}),
      events: {},
      component: ProbeComponent,
    })

    await mountWidget(probe)

    expect(seen).toEqual({ id: 'probe', basePath: '' })
  })

  it('keeps two mounts of one Widget independent', async () => {
    const environment = createMfeTestEnvironment({ definitions: [alertWidget] })
    const first = await mountWidget(alertWidget, { environment, inputs: { alertId: 'first' } })
    const second = await mountWidget(alertWidget, { environment, inputs: { alertId: 'second' } })

    await first.update({ alertId: 'changed' })
    button(second.element).click()
    await first.dispose()

    expect(second.element.querySelector('p')?.textContent).toBe('second:info')
    expect(first.events).toEqual([])
    expect(second.events).toEqual([{ name: 'acknowledged', payload: { alertId: 'second' } }])
    environment.dispose()
  })

  describe('checking the component against the contract', () => {
    it('names an input the schema declares and the component does not, and the repair', async () => {
      const missingInput = createWidget({
        id: 'missing-input',
        inputs: alertContract.inputs.extend({ title: z.string() }),
        events: alertContract.events,
        component: AlertComponent,
      })

      await expect(
        mountWidget(missingInput, { inputs: { alertId: 'a-1', title: 'x' } }),
      ).rejects.toThrowError(
        /expected an input named "title" on AlertComponent, because the inputs schema declares it, received inputs alertId, severity\. Declare it on the component: `title = input\.required<…>\(\)`/,
      )
    })

    it('names an event the component has no output for, and the repair', async () => {
      const missingOutput = createWidget({
        id: 'missing-output',
        inputs: alertContract.inputs,
        events: { ...alertContract.events, dismissed: z.object({}) },
        component: AlertComponent,
      })

      await expect(mountWidget(missingOutput, { inputs: { alertId: 'a-1' } })).rejects.toThrowError(
        /expected an output named "dismissed" on AlertComponent, because the events schema declares it, received outputs acknowledged\. Declare it on the component: `dismissed = output<…>\(\)`/,
      )
    })

    it('refuses an input name a host reserves', async () => {
      @Component({ selector: 'test-keyed', template: '' })
      class KeyedComponent {
        @Input() key = ''
      }
      const keyed = createWidget({
        id: 'keyed',
        inputs: z.object({ key: z.string() }),
        events: {},
        component: KeyedComponent,
      })

      await expect(mountWidget(keyed, { inputs: { key: 'k' } })).rejects.toThrowError(
        /keyed failed to declare input 'key'/,
      )
    })
  })

  describe('failures while mounting', () => {
    it('rejects when the component throws during its first render, leaving nothing behind', async () => {
      @Component({ selector: 'test-throwing', template: '{{ explode() }}' })
      class ThrowingComponent {
        explode(): string {
          throw new Error('boom')
        }
      }
      const throwing = createWidget({
        id: 'throwing',
        inputs: z.object({}),
        events: {},
        component: ThrowingComponent,
      })

      await expect(mountWidget(throwing)).rejects.toThrowError(
        /throwing failed to render the definition: Error: boom/,
      )
      expect(document.body.childElementCount).toBe(0)
    })

    it('names the Widget when one of its own providers fails', async () => {
      const misconfigured = createWidget({
        id: 'misconfigured',
        ...alertContract,
        component: AlertComponent,
        providers: [
          provideEnvironmentInitializer(() => {
            throw new Error('no API base URL')
          }),
        ],
      })

      await expect(mountWidget(misconfigured, { inputs: { alertId: 'a-1' } })).rejects.toThrowError(
        /misconfigured failed to create its application: Error: no API base URL/,
      )
    })

    it('reports a failure after mounting to the shell’s diagnostics, not the console', async () => {
      @Component({ selector: 'test-faulty', template: '<button (click)="fail()">go</button>' })
      class FaultyComponent {
        fail(): void {
          throw new Error('handler failed')
        }
      }
      const faulty = createWidget({
        id: 'faulty',
        inputs: z.object({}),
        events: {},
        component: FaultyComponent,
      })
      const widget = await mountWidget(faulty)

      button(widget.element).click()

      expect(widget.environment.diagnostics).toHaveLength(1)
      expect(widget.environment.diagnostics[0]?.error).toMatchObject({
        code: 'mount/failure',
        id: 'faulty',
      })
      expect(widget.environment.diagnostics[0]?.error.message).toContain('Error: handler failed')
    })

    it('stops when the host disposes the mount before it finished', async () => {
      const environment = createMfeTestEnvironment()
      const handle = createMountContext({
        runtime: environment.runtime,
        definitionId: alertWidget.id,
        kind: 'widget',
      })
      const element = document.createElement('div')
      document.body.appendChild(element)

      const mounting = alertWidget.mount({
        element,
        context: handle.context,
        inputs: { alertId: 'a-1' },
        emit: () => undefined,
      })
      await handle.dispose()

      await expect(mounting).rejects.toThrowError(
        /the mount was disposed before it finished mounting/,
      )
      expect(element.childElementCount).toBe(0)
      element.remove()
      environment.dispose()
    })

    it('tears the application down when the host disposes only the context', async () => {
      const environment = createMfeTestEnvironment()
      const handle = createMountContext({
        runtime: environment.runtime,
        definitionId: alertWidget.id,
        kind: 'widget',
      })
      const element = document.createElement('div')
      document.body.appendChild(element)
      await alertWidget.mount({
        element,
        context: handle.context,
        inputs: { alertId: 'a-1' },
        emit: () => undefined,
      })

      await handle.dispose()
      await Promise.resolve()

      expect(destroyedAlerts).toBe(1)
      expect(element.childElementCount).toBe(0)
      element.remove()
      environment.dispose()
    })
  })
})
