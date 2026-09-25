/**
 * Definitions no framework built: each renders plain DOM into the element it is handed and records
 * every call its host makes through the neutral contract. A React host has to place them exactly
 * as it places a React definition, because it never asks which framework built what it places.
 */

import { DEFINITION_BRAND, type WidgetContract } from '@company/mfe-core'
import type {
  AppMountTarget,
  MountableAppDefinition,
  MountableWidgetDefinition,
  MountedApp,
  MountedWidget,
  WidgetMountTarget,
} from '@company/mfe-runtime'
import { act } from '@testing-library/react'
import { z } from 'zod'

/** Any string names the framework; this one names none the repository ships. */
const FRAMEWORK = 'plain-dom'

export const alertContract = {
  inputSchema: z.object({ label: z.string() }),
  outputSchema: z.object({ acknowledged: z.object({ alertId: z.string() }) }),
} satisfies WidgetContract

interface Settlement {
  readonly resolve: () => void
  readonly reject: (error: unknown) => void
}

export interface DomWidget {
  readonly definition: MountableWidgetDefinition
  readonly targets: readonly WidgetMountTarget[]
  readonly updates: readonly Readonly<Record<string, unknown>>[]
  /** One per mount still waiting, when the Widget settles manually. */
  readonly settlements: readonly Settlement[]
  readonly disposals: number
  failNextMount(error: Error): void
  /** What the provider does after validating a payload against its own schema. */
  emit(event: string, payload: unknown): void
}

export function domWidget(options: { readonly settleManually?: boolean } = {}): DomWidget {
  const targets: WidgetMountTarget[] = []
  const updates: Readonly<Record<string, unknown>>[] = []
  const settlements: Settlement[] = []
  let disposals = 0
  let failNext: Error | null = null

  const definition: MountableWidgetDefinition = {
    [DEFINITION_BRAND]: true,
    kind: 'widget',
    id: 'alert-panel',
    version: '1.4.0',
    framework: FRAMEWORK,
    contract: alertContract,
    mount: target => {
      targets.push(target)
      if (failNext !== null) {
        const error = failNext
        failNext = null
        return Promise.reject(error)
      }

      const rendered = target.element.ownerDocument.createElement('p')
      rendered.dataset['testid'] = 'dom-label'
      rendered.textContent = String(target.inputs['label'])

      const mounted: MountedWidget = {
        update: inputs => {
          updates.push(inputs)
          rendered.textContent = String(inputs['label'])
        },
        dispose: () => {
          disposals += 1
          rendered.remove()
          return Promise.resolve()
        },
      }

      if (options.settleManually !== true) {
        target.element.append(rendered)
        return Promise.resolve(mounted)
      }
      return new Promise<MountedWidget>((resolve, reject) => {
        settlements.push({
          resolve: () => {
            target.element.append(rendered)
            resolve(mounted)
          },
          reject,
        })
      })
    },
  }

  return {
    definition,
    targets,
    updates,
    settlements,
    get disposals() {
      return disposals
    },
    failNextMount: error => {
      failNext = error
    },
    emit: (event, payload) => {
      const target = targets.at(-1)
      if (!target) throw new Error('the Widget was never mounted')
      act(() => {
        target.emit(event, payload)
      })
    },
  }
}

export interface DomApp {
  readonly definition: MountableAppDefinition
  readonly targets: readonly AppMountTarget[]
  readonly disposals: number
  failNextMount(error: Error): void
  /** What a framework root does when it can no longer render, once the mount has resolved. */
  failAfterMount(error: Error): void
}

export function domApp(id = 'reports'): DomApp {
  const targets: AppMountTarget[] = []
  let disposals = 0
  let failNext: Error | null = null

  const definition: MountableAppDefinition = {
    [DEFINITION_BRAND]: true,
    kind: 'app',
    id,
    framework: FRAMEWORK,
    contributesBreadcrumbs: true,
    mount: target => {
      targets.push(target)
      if (failNext !== null) {
        const error = failNext
        failNext = null
        return Promise.reject(error)
      }

      const rendered = target.element.ownerDocument.createElement('main')
      rendered.dataset['testid'] = 'dom-app'
      rendered.textContent = `Reports at ${target.context.basePath}`
      target.element.append(rendered)

      const mounted: MountedApp = {
        dispose: () => {
          disposals += 1
          rendered.remove()
          return Promise.resolve()
        },
      }
      return Promise.resolve(mounted)
    },
  }

  return {
    definition,
    targets,
    get disposals() {
      return disposals
    },
    failNextMount: error => {
      failNext = error
    },
    failAfterMount: error => {
      const target = targets.at(-1)
      if (!target) throw new Error('the App was never mounted')
      act(() => {
        target.onFailure(error)
      })
    },
  }
}
