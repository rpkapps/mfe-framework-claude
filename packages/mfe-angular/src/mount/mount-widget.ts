/**
 * Mounting a Widget: one Angular application per mount, its component created into an element the
 * mount owns, its inputs validated against the Widget's own contract and its outputs routed to the
 * host through the same validating emit `injectWidgetEmit` uses. An accepted input update is set
 * on the live component rather than remounting it.
 */

import { createComponent, type ComponentRef, type EnvironmentInjector } from '@angular/core'
import { createApplication } from '@angular/platform-browser'
import { shallowEqual, toMfeError } from '@company/mfe-core'
import type { MountedWidget, WidgetMountTarget } from '@company/mfe-host'

import type { WidgetDefinition } from '../definition.ts'
import { WIDGET_EMIT } from '../inject/tokens.ts'
import { readComponentContract, type ComponentContract } from './component-contract.ts'
import {
  createHostElement,
  disposedWhileMounting,
  MountErrorHandler,
  provideMfeMount,
} from './mount-providers.ts'
import { createWidgetEmitter, validateInputs } from './widget-channel.ts'

/** What an Angular Widget's `mount` resolves to; the extras serve tests and Angular hosts. */
export interface AngularMountedWidget extends MountedWidget {
  /** The mount's own application injector. */
  readonly injector: EnvironmentInjector
  /** Resolves once zoneless change detection has nothing left to do. */
  whenStable(): Promise<void>
}

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
): Promise<AngularMountedWidget> {
  const { context } = target
  if (context.signal.aborted) throw disposedWhileMounting(context)

  const component = readComponentContract(definition)
  const first = validateInputs(definition, component, target.inputs)
  // Nothing to fall back to on the first mount, so the validation error itself is the rejection.
  if (!first.ok) throw first.error

  const errors = new MountErrorHandler(context)
  const emit = createWidgetEmitter(definition, target.emit)

  const appRef = await createApplication({
    providers: [
      ...provideMfeMount(context, errors),
      { provide: WIDGET_EMIT, useValue: emit },
      ...definition.providers,
    ],
  })

  if (context.signal.aborted) {
    appRef.destroy()
    throw disposedWhileMounting(context)
  }

  const hostElement = createHostElement(target.element)
  const rendered = errors.capture(() => {
    const ref = createComponent(definition.component, {
      environmentInjector: appRef.injector,
      hostElement,
    })
    for (const [name, value] of Object.entries(first.value)) ref.setInput(name, value)
    const subscriptions = subscribeToEvents(ref, component, emit, errors)
    appRef.attachView(ref.hostView)
    appRef.tick()
    return { ref, subscriptions }
  })

  if (!rendered.ok) {
    appRef.destroy()
    hostElement.remove()
    throw rendered.error
  }

  const { ref, subscriptions } = rendered.value

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

  let checked = target.inputs
  let valid = first.value
  let disposal: Promise<void> | null = null

  const dispose = (): Promise<void> => {
    disposal ??= (async () => {
      for (const subscription of subscriptions) subscription.unsubscribe()
      try {
        appRef.destroy()
      } catch (error) {
        context.runtime.diagnostics.report(
          toMfeError(error, {
            code: 'dispose/failure',
            id: definition.id,
            ...(definition.version === undefined ? {} : { definitionVersion: definition.version }),
            operation: 'dispose Widget',
            repair: 'Check the ngOnDestroy hooks and DestroyRef callbacks inside the Widget.',
          }),
        )
      }
      hostElement.remove()
      await Promise.resolve()
    })()
    return disposal
  }

  // The host disposes this handle before the context; a host that only disposes the context
  // still gets the application torn down.
  context.signal.addEventListener('abort', () => void dispose(), { once: true })

  return {
    injector: appRef.injector,
    whenStable: () => appRef.whenStable(),
    dispose,

    update: inputs => {
      if (disposal !== null || shallowEqual(inputs, checked)) return
      checked = inputs

      const next = validateInputs(definition, component, inputs)
      if (!next.ok) {
        // The mount keeps rendering its last valid inputs; the host hears about the rejection.
        context.runtime.diagnostics.report(next.error, { context: { widget: definition.id } })
        target.onInputRejected?.(next.error)
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
