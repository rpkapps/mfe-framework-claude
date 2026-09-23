/**
 * Fixtures for exercising the adapter from a host application's side: an Angular application with
 * the runtime provided and no mount around it, which is where shell chrome and host components
 * live, torn down when the test finishes.
 */

import {
  createComponent,
  provideExperimentalZonelessChangeDetection,
  type ApplicationRef,
  type ComponentRef,
  type EnvironmentProviders,
  type Provider,
  type Type,
} from '@angular/core'
import { createApplication } from '@angular/platform-browser'
import { onTestFinished } from 'vitest'

import type { MfeTestEnvironment } from '../testing/index.ts'

export async function createHostApplication(
  environment: MfeTestEnvironment | null,
  providers: readonly (Provider | EnvironmentProviders)[] = [],
): Promise<ApplicationRef> {
  const appRef = await createApplication({
    providers: [
      provideExperimentalZonelessChangeDetection(),
      ...(environment === null ? [] : [environment.providers]),
      ...providers,
    ],
  })
  onTestFinished(() => {
    if (!appRef.destroyed) appRef.destroy()
  })
  return appRef
}

export interface RenderedHost<T> {
  readonly ref: ComponentRef<T>
  readonly element: HTMLElement
}

/**
 * Renders `component` as a root view of the host application and waits for it to settle; `setup`
 * runs before the first change detection, so it decides what the first render binds.
 */
export async function renderInHost<T>(
  appRef: ApplicationRef,
  component: Type<T>,
  setup: (instance: T) => void = () => undefined,
): Promise<RenderedHost<T>> {
  const element = document.createElement('div')
  document.body.appendChild(element)
  onTestFinished(() => {
    element.remove()
  })

  const ref = createComponent(component, {
    environmentInjector: appRef.injector,
    hostElement: element,
  })
  setup(ref.instance)
  appRef.attachView(ref.hostView)
  await appRef.whenStable()
  return { ref, element }
}

/** Lets a pending promise chain and the zoneless scheduler run to completion. */
export async function settle(appRef?: ApplicationRef): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
  await appRef?.whenStable()
}
