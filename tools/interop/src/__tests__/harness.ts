/**
 * What every cross-framework scenario starts from: one memory runtime seeded with real definitions
 * from both adapters, so a React host and an Angular host resolve them through the same registry
 * and loader production uses; a React host page and an Angular host application over that runtime;
 * and the counts a teardown assertion reads.
 *
 * The suites are `.ts` rather than `.tsx` because the repository's lint configuration covers only
 * `.ts` sources under `tools/`, so the React trees here are written with `createElement`.
 *
 * Waiting goes through Testing Library's `waitFor` rather than `vi.waitFor`: it suspends React's
 * act environment while it polls, so a React root an Angular host mounts or updates renders on
 * React's own scheduler, as it does in a browser, instead of warning that no `act` wrapped it.
 */

import {
  DestroyRef,
  createComponent,
  inject,
  provideEnvironmentInitializer,
  provideExperimentalZonelessChangeDetection,
  type ApplicationRef,
  type ComponentRef,
  type EnvironmentProviders,
  type Type,
} from '@angular/core'
import { createApplication } from '@angular/platform-browser'
import { provideMfeRuntime } from '@company/mfe-angular'
import { OVERLAY_ROOT_ATTRIBUTE, type MfeHostRuntime } from '@company/mfe-host'
import {
  createMemoryHostRuntime,
  type MemoryHostRuntime,
  type MemoryHostRuntimeOptions,
} from '@company/mfe-host/testing'
import { MfeProvider } from '@company/mfe-react'
import { createElement as h, Suspense, type ReactNode } from 'react'
import { onTestFinished } from 'vitest'

/**
 * One runtime for the whole page, disposed when the test finishes. Hooks registered with
 * `onTestFinished` run after the setup's Testing Library cleanup and in reverse order, so every
 * mount and every host application is gone before the runtime they registered with.
 */
export function createPageRuntime(options: MemoryHostRuntimeOptions): MemoryHostRuntime {
  const memory = createMemoryHostRuntime(options)
  onTestFinished(() => {
    memory.dispose()
  })
  return memory
}

/** A React host page: the runtime provided once, with a Suspense boundary for the loads. */
export function reactHostPage(runtime: MfeHostRuntime, children: ReactNode): ReactNode {
  return h(MfeProvider, { runtime }, h(Suspense, { fallback: null }, children))
}

/** An Angular host application: zoneless, with the runtime provided once, as a shell boots one. */
export async function createAngularHost(runtime: MfeHostRuntime): Promise<ApplicationRef> {
  const appRef = await createApplication({
    providers: [provideExperimentalZonelessChangeDetection(), provideMfeRuntime(runtime)],
  })
  onTestFinished(() => {
    if (!appRef.destroyed) appRef.destroy()
  })
  return appRef
}

export interface AngularHostView<T> {
  readonly ref: ComponentRef<T>
  /** The host component's element, attached to `document.body`. */
  readonly element: HTMLElement
}

/** Renders `component` as a root view of the host application and waits for it to settle. */
export async function renderInAngularHost<T>(
  appRef: ApplicationRef,
  component: Type<T>,
): Promise<AngularHostView<T>> {
  const element = document.createElement('div')
  document.body.appendChild(element)
  onTestFinished(() => {
    element.remove()
  })

  const ref = createComponent(component, {
    environmentInjector: appRef.injector,
    hostElement: element,
  })
  appRef.attachView(ref.hostView)
  await appRef.whenStable()
  return { ref, element }
}

/**
 * Counts the Angular applications a definition's mounts create and destroy. Each mount is its own
 * application, and an environment initializer runs once per application injector, so its
 * `DestroyRef` callback is exactly "this application was destroyed".
 */
export interface ApplicationCensus {
  /** Passed as the definition's `providers`. */
  readonly providers: EnvironmentProviders
  readonly created: number
  readonly live: number
}

export function applicationCensus(): ApplicationCensus {
  let created = 0
  let destroyed = 0

  return {
    providers: provideEnvironmentInitializer(() => {
      created += 1
      inject(DestroyRef).onDestroy(() => {
        destroyed += 1
      })
    }),
    get created() {
      return created
    },
    get live() {
      return created - destroyed
    },
  }
}

/** The body-level overlay roots every mount context creates and must remove on disposal. */
export function overlayRootCount(): number {
  return document.querySelectorAll(`[${OVERLAY_ROOT_ATTRIBUTE}]`).length
}
