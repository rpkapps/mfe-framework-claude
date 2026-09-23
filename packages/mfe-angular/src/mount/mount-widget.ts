/**
 * Mounting a Widget: one Angular application per mount, its component created into an element the
 * mount owns, its inputs validated against the Widget's own contract and its outputs routed to the
 * host through the same validating emit `injectWidgetEmit` uses. An accepted input update is set
 * on the live component rather than remounting it.
 */

import { createComponent, type ComponentRef } from '@angular/core'
import {
  createProviderEmit,
  type MountedWidget,
  type WidgetMountTarget,
} from '@company/mfe-runtime'

import type { WidgetDefinition } from '../definition.ts'
import { WIDGET_EMIT } from '../inject/tokens.ts'
import { readComponentContract, type ComponentContract } from './component-contract.ts'
import { disposedWhileMounting, MountErrorHandler, runMountApplication } from './mount-providers.ts'
import { validateInputs } from './widget-channel.ts'

interface Subscribable {
  subscribe(next: (payload: unknown) => void): { unsubscribe(): void }
}

function isSubscribable(value: unknown): value is Subscribable {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { subscribe?: unknown }).subscribe === 'function'
  )
}

/**
 * Angular's output machinery sits between the component's `emit` and these listeners and would
 * swallow or defer a throw, so a rejected payload reaches the mount's error handler instead.
 */
function subscribeToEvents(
  ref: ComponentRef<unknown>,
  component: ComponentContract,
  emit: (event: string, payload: unknown) => void,
  errors: MountErrorHandler,
): readonly { unsubscribe(): void }[] {
  const instance = ref.instance as Record<string, unknown>

  return [...component.outputs].map(([event, property]) => {
    const output = instance[property]
    if (!isSubscribable(output)) {
      throw new TypeError(`The output "${property}" for event '${event}' has no subscribe method.`)
    }
    return output.subscribe(payload => {
      try {
        emit(event, payload)
      } catch (error) {
        errors.handleError(error)
      }
    })
  })
}

export async function mountWidget(
  definition: WidgetDefinition,
  target: WidgetMountTarget,
): Promise<MountedWidget> {
  // Only what outlives mounting is kept, so the long-lived closures below never hold the first
  // input set or the rest of the target.
  const { context, onFailure, onInputRejected } = target
  if (context.signal.aborted) throw disposedWhileMounting(context)

  const component = readComponentContract(definition)
  const first = validateInputs(definition, component, target.inputs)
  // Nothing to fall back to on the first mount, so the validation error itself is the rejection.
  if (first.status !== 'accepted') throw first.error
  let valid = first.value

  const errors = new MountErrorHandler(context)
  const emit = createProviderEmit(definition, target.emit)

  const mounted = await runMountApplication({
    definition,
    target,
    errors,
    providers: [{ provide: WIDGET_EMIT, useValue: emit }],
    render: (application, hostElement) => {
      const ref = createComponent(definition.component, {
        environmentInjector: application.injector,
        hostElement,
      })
      for (const [name, value] of Object.entries(valid)) ref.setInput(name, value)
      const subscriptions = subscribeToEvents(ref, component, emit, errors)
      application.attachView(ref.hostView)
      application.tick()
      return { ref, subscriptions }
    },
    start: ({ subscriptions }) => {
      return () => {
        for (const subscription of subscriptions) subscription.unsubscribe()
      }
    },
  })
  const { ref } = mounted.rendered

  /**
   * An Angular host updates from inside its own change detection, where Angular's refreshing flag
   * is global: `setInput` then marks this application's view dirty without scheduling its refresh,
   * so the update is rendered here instead of waiting for an unrelated tick. A failure has already
   * reached the mount's error handler, which reported it, when `detectChanges` rethrows it.
   */
  const render = (): void => {
    try {
      ref.changeDetectorRef.detectChanges()
    } catch {
      // Reported by the mount's ErrorHandler before Angular rethrew it.
    }
  }

  return {
    dispose: mounted.dispose,
    whenStable: mounted.whenStable,

    // The host passes only a set that changed, so every call is validated.
    update: inputs => {
      if (mounted.isDisposed()) return

      const next = validateInputs(definition, component, inputs)
      // No later set can repair a reserved input name, so the mount fails rather than keeping
      // its last valid inputs; the runtime reports the failure and tears the mount down.
      if (next.status === 'misdeclared') {
        onFailure(next.error)
        return
      }
      if (next.status === 'rejected') {
        // The mount keeps rendering its last valid inputs; the host hears about the rejection.
        context.runtime.diagnostics.report(next.error, { context: { widget: definition.id } })
        onInputRejected?.(next.error)
        return
      }

      const previous = valid
      valid = next.value
      let changed = false
      for (const name of new Set([...Object.keys(previous), ...Object.keys(next.value)])) {
        if (Object.is(previous[name], next.value[name])) continue
        ref.setInput(name, next.value[name])
        changed = true
      }
      if (changed) render()
    },
  }
}
