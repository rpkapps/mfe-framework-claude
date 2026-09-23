/**
 * A React host placing a definition another framework built. It cannot render that tree, so it
 * hands the definition an element inside the mount's scope root and the definition mounts itself
 * there; everything else a consumer relies on — inputs, events, retry, disposal — has to behave
 * exactly as it does for a React definition.
 */

import { DEFINITION_BRAND } from '@company/mfe-core'
import type {
  AppMountTarget,
  MountableAppDefinition,
  MountableWidgetDefinition,
  MountedApp,
  MountedWidget,
  WidgetMountTarget,
} from '@company/mfe-runtime'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode, Suspense, useState, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { AppHost } from './app-host.tsx'
import { DynamicWidget, lazyWidget } from './lazy-widget.tsx'
import { MfeProvider } from './runtime-context.tsx'
import { KIND_ATTRIBUTE, MOUNT_ATTRIBUTE, SCOPE_ATTRIBUTE } from './scope-root.tsx'
import {
  createMfeTestEnvironment,
  renderSuspending,
  type MfeTestEnvironment,
} from './testing/index.tsx'

let environment: MfeTestEnvironment | null = null

afterEach(async () => {
  const current = environment
  environment = null
  await current?.dispose()
})

const alertContract = {
  inputs: z.object({ label: z.string() }),
  events: { acknowledged: z.object({ alertId: z.string() }) },
}

interface Settlement {
  readonly resolve: () => void
  readonly reject: (error: unknown) => void
}

/**
 * Stands in for an Angular Widget: it renders its label into the element it was given, and
 * records every call a host makes through the neutral contract.
 */
function foreignWidget(options: { readonly settleManually?: boolean } = {}) {
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
    framework: 'angular',
    contract: alertContract,
    mount: target => {
      targets.push(target)
      if (failNext !== null) {
        const error = failNext
        failNext = null
        return Promise.reject(error)
      }

      const rendered = document.createElement('p')
      rendered.dataset['testid'] = 'foreign-label'
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

      if (!options.settleManually) {
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
    get disposals(): number {
      return disposals
    },
    failNextMount(error: Error): void {
      failNext = error
    },
    /** What the provider does after validating a payload against its own schema. */
    emit(event: string, payload: unknown): void {
      const target = targets.at(-1)
      if (!target) throw new Error('the Widget was never mounted')
      act(() => {
        target.emit(event, payload)
      })
    },
  }
}

function foreignApp() {
  const targets: AppMountTarget[] = []
  let disposals = 0
  let failNext: Error | null = null

  const definition: MountableAppDefinition = {
    [DEFINITION_BRAND]: true,
    kind: 'app',
    id: 'reports',
    framework: 'angular',
    contributesBreadcrumbs: true,
    mount: target => {
      targets.push(target)
      if (failNext !== null) {
        const error = failNext
        failNext = null
        return Promise.reject(error)
      }

      const rendered = document.createElement('main')
      rendered.dataset['testid'] = 'foreign-app'
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
    get disposals(): number {
      return disposals
    },
    failNextMount(error: Error): void {
      failNext = error
    },
  }
}

function hosted(runtime: MfeTestEnvironment['runtime'], children: ReactNode): ReactNode {
  return (
    <MfeProvider runtime={runtime}>
      <Suspense fallback={null}>{children}</Suspense>
    </MfeProvider>
  )
}

/** Retrying suspends on a fresh load, which React resumes only inside an awaited act scope. */
async function clickRetry(): Promise<void> {
  await act(async () => {
    screen.getByRole('button', { name: 'Retry' }).click()
    await Promise.resolve()
  })
}

function retryable({ error, retry }: { error: Error; retry: () => void }): ReactNode {
  return (
    <div>
      <p data-testid="error">{error.message}</p>
      <button type="button" onClick={retry}>
        Retry
      </button>
    </div>
  )
}

describe('a Widget another framework built', () => {
  it('mounts itself into an element inside the mount’s scope root', async () => {
    const widget = foreignWidget()
    environment = createMfeTestEnvironment({
      definitionId: 'host',
      definitions: [widget.definition],
    })

    await renderSuspending(
      hosted(environment.runtime, <DynamicWidget widgetId="alert-panel" label="Disk full" />),
    )

    await waitFor(() => {
      expect(screen.getByTestId('foreign-label')).toHaveTextContent('Disk full')
    })
    const target = widget.targets[0]
    const scopeRoot = target?.element.closest(`[${SCOPE_ATTRIBUTE}]`)
    expect(scopeRoot?.getAttribute(SCOPE_ATTRIBUTE)).toBe('alert-panel')
    expect(scopeRoot?.getAttribute(MOUNT_ATTRIBUTE)).toBe(target?.context.mountToken)
    expect(scopeRoot?.getAttribute(KIND_ATTRIBUTE)).toBe('widget')
    expect(target?.context).toMatchObject({ definitionId: 'alert-panel', kind: 'widget' })
    expect(target?.inputs).toEqual({ label: 'Disk full' })
  })

  it('hands a changed input to the mount it has rather than mounting again', async () => {
    const widget = foreignWidget()
    environment = createMfeTestEnvironment({
      definitionId: 'host',
      definitions: [widget.definition],
    })

    function Host(): ReactNode {
      const [label, setLabel] = useState('Disk full')
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setLabel('Disk cleared')
            }}
          >
            change
          </button>
          <DynamicWidget widgetId="alert-panel" label={label} />
        </>
      )
    }

    await renderSuspending(hosted(environment.runtime, <Host />))
    await waitFor(() => {
      expect(screen.getByTestId('foreign-label')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: 'change' }))

    expect(screen.getByTestId('foreign-label')).toHaveTextContent('Disk cleared')
    expect(widget.updates).toEqual([{ label: 'Disk cleared' }])
    expect(widget.targets).toHaveLength(1)
  })

  it('does not hand over inputs that are equal to the ones it already has', async () => {
    const widget = foreignWidget()
    environment = createMfeTestEnvironment({
      definitionId: 'host',
      definitions: [widget.definition],
    })

    function Host(): ReactNode {
      const [renders, setRenders] = useState(0)
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setRenders(current => current + 1)
            }}
          >
            re-render {renders}
          </button>
          <DynamicWidget widgetId="alert-panel" label="Disk full" onAcknowledged={() => renders} />
        </>
      )
    }

    await renderSuspending(hosted(environment.runtime, <Host />))
    await waitFor(() => {
      expect(screen.getByTestId('foreign-label')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: /re-render/ }))
    await userEvent.click(screen.getByRole('button', { name: /re-render/ }))

    // New props objects and a new handler each time, and still nothing for the provider to do.
    expect(widget.updates).toEqual([])
    expect(widget.targets).toHaveLength(1)
  })

  it('delivers inputs that changed while the mount was pending once it settles', async () => {
    const widget = foreignWidget({ settleManually: true })
    environment = createMfeTestEnvironment({
      definitionId: 'host',
      definitions: [widget.definition],
    })

    const rendered = await renderSuspending(
      hosted(environment.runtime, <DynamicWidget widgetId="alert-panel" label="Disk full" />),
    )
    await waitFor(() => {
      expect(widget.settlements).toHaveLength(1)
    })

    rendered.rerender(
      hosted(environment.runtime, <DynamicWidget widgetId="alert-panel" label="Disk cleared" />),
    )
    await act(async () => {
      widget.settlements[0]?.resolve()
      await Promise.resolve()
    })

    expect(widget.targets[0]?.inputs).toEqual({ label: 'Disk full' })
    expect(widget.updates).toEqual([{ label: 'Disk cleared' }])
    expect(screen.getByTestId('foreign-label')).toHaveTextContent('Disk cleared')
  })

  it('routes an event the provider emits to its onX handler and to the catch-all', async () => {
    const widget = foreignWidget()
    environment = createMfeTestEnvironment({
      definitionId: 'host',
      definitions: [widget.definition],
    })
    const onAcknowledged = vi.fn()
    const onEvent = vi.fn()

    await renderSuspending(
      hosted(
        environment.runtime,
        <DynamicWidget
          widgetId="alert-panel"
          label="Disk full"
          onAcknowledged={onAcknowledged}
          onEvent={onEvent}
        />,
      ),
    )
    await waitFor(() => {
      expect(widget.targets).toHaveLength(1)
    })

    widget.emit('acknowledged', { alertId: 'a-1' })

    expect(onAcknowledged).toHaveBeenCalledWith({ alertId: 'a-1' })
    expect(onEvent).toHaveBeenCalledWith('acknowledged', { alertId: 'a-1' })
  })

  it('reaches the handler committed last, without mounting again', async () => {
    const widget = foreignWidget()
    environment = createMfeTestEnvironment({
      definitionId: 'host',
      definitions: [widget.definition],
    })
    const first = vi.fn()
    const second = vi.fn()

    const rendered = await renderSuspending(
      hosted(
        environment.runtime,
        <DynamicWidget widgetId="alert-panel" label="Disk full" onAcknowledged={first} />,
      ),
    )
    await waitFor(() => {
      expect(widget.targets).toHaveLength(1)
    })
    rendered.rerender(
      hosted(
        environment.runtime,
        <DynamicWidget widgetId="alert-panel" label="Disk full" onAcknowledged={second} />,
      ),
    )

    widget.emit('acknowledged', { alertId: 'a-1' })

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
    expect(widget.targets).toHaveLength(1)
  })

  /** A consumer-side mismatch is the consumer's to fix, never a throw into the provider. */
  it('reports an event its consumer’s contract rejects instead of delivering it', async () => {
    const widget = foreignWidget()
    environment = createMfeTestEnvironment({
      definitionId: 'host',
      definitions: [widget.definition],
    })
    const AlertPanel = lazyWidget('alert-panel', {
      contract: {
        inputs: alertContract.inputs,
        events: { acknowledged: z.object({ alertId: z.string().startsWith('alert-') }) },
      },
    })
    const onAcknowledged = vi.fn()

    await renderSuspending(
      hosted(environment.runtime, <AlertPanel label="Disk full" onAcknowledged={onAcknowledged} />),
    )
    await waitFor(() => {
      expect(widget.targets).toHaveLength(1)
    })

    expect(() => {
      widget.emit('acknowledged', { alertId: 'a-1' })
    }).not.toThrow()
    widget.emit('acknowledged', { alertId: 'alert-2' })

    expect(onAcknowledged.mock.calls).toEqual([[{ alertId: 'alert-2' }]])
    expect(environment.diagnostics).toHaveLength(1)
    expect(environment.diagnostics[0]?.error).toMatchObject({
      code: 'contract/event-mismatch',
      id: 'alert-panel',
    })
  })

  it('disposes the mount when the Widget leaves the page', async () => {
    const widget = foreignWidget()
    environment = createMfeTestEnvironment({
      definitionId: 'host',
      definitions: [widget.definition],
    })

    const rendered = await renderSuspending(
      hosted(environment.runtime, <DynamicWidget widgetId="alert-panel" label="Disk full" />),
    )
    await waitFor(() => {
      expect(widget.targets).toHaveLength(1)
    })
    const signal = widget.targets[0]?.context.signal

    rendered.unmount()

    await waitFor(() => {
      expect(widget.disposals).toBe(1)
    })
    expect(signal?.aborted).toBe(true)
    expect(screen.queryByTestId('foreign-label')).not.toBeInTheDocument()
  })

  /** Nothing is left to dispose it later, so it is disposed the moment it arrives. */
  it('disposes a mount that settles after the Widget already left the page', async () => {
    const widget = foreignWidget({ settleManually: true })
    environment = createMfeTestEnvironment({
      definitionId: 'host',
      definitions: [widget.definition],
    })

    const rendered = await renderSuspending(
      hosted(environment.runtime, <DynamicWidget widgetId="alert-panel" label="Disk full" />),
    )
    await waitFor(() => {
      expect(widget.settlements).toHaveLength(1)
    })

    rendered.unmount()
    await act(async () => {
      widget.settlements[0]?.resolve()
      await Promise.resolve()
    })

    expect(widget.disposals).toBe(1)
    expect(widget.updates).toEqual([])
  })

  /** StrictMode mounts, cleans up and mounts again; only the last mount may stay live (§14). */
  it('leaves exactly one live mount under StrictMode', async () => {
    const widget = foreignWidget()
    environment = createMfeTestEnvironment({
      definitionId: 'host',
      definitions: [widget.definition],
    })

    await renderSuspending(
      <StrictMode>
        {hosted(environment.runtime, <DynamicWidget widgetId="alert-panel" label="Disk full" />)}
      </StrictMode>,
    )

    await waitFor(() => {
      expect(screen.getAllByTestId('foreign-label')).toHaveLength(1)
    })
    expect(widget.targets.length).toBeGreaterThan(1)
    expect(widget.disposals).toBe(widget.targets.length - 1)
    expect(widget.targets.at(-1)?.element).toContainElement(screen.getByTestId('foreign-label'))
  })

  it('shows a rejected mount in the fallback, and mounts again on retry', async () => {
    const widget = foreignWidget()
    widget.failNextMount(new Error('NG0303: Can’t set value of the label input'))
    environment = createMfeTestEnvironment({
      definitionId: 'host',
      definitions: [widget.definition],
    })

    await renderSuspending(
      hosted(
        environment.runtime,
        <DynamicWidget widgetId="alert-panel" label="Disk full" fallback={retryable} />,
      ),
    )

    await waitFor(() => {
      expect(screen.getByTestId('error')).toHaveTextContent('NG0303')
    })
    expect(screen.getByTestId('error')).toHaveTextContent('alert-panel')

    await clickRetry()

    await waitFor(() => {
      expect(screen.getByTestId('foreign-label')).toHaveTextContent('Disk full')
    })
    expect(widget.targets).toHaveLength(2)
    expect(screen.queryByTestId('error')).not.toBeInTheDocument()
  })
})

describe('an App another framework built', () => {
  it('mounts itself inside the App’s scope root, at the boundary it was given', async () => {
    const app = foreignApp()
    environment = createMfeTestEnvironment({ definitionId: 'shell', definitions: [app.definition] })

    await renderSuspending(
      hosted(environment.runtime, <AppHost appId="reports" basePath="/reports" />),
    )

    await waitFor(() => {
      expect(screen.getByTestId('foreign-app')).toHaveTextContent('Reports at /reports')
    })
    const target = app.targets[0]
    const scopeRoot = target?.element.closest(`[${SCOPE_ATTRIBUTE}]`)
    expect(scopeRoot?.getAttribute(SCOPE_ATTRIBUTE)).toBe('reports')
    expect(scopeRoot?.getAttribute(MOUNT_ATTRIBUTE)).toBe(target?.context.mountToken)
    expect(scopeRoot?.getAttribute(KIND_ATTRIBUTE)).toBe('app')
    expect(target?.context).toMatchObject({ kind: 'app', basePath: '/reports', depth: 1 })
    expect(target?.context.runtime.navigator).toBe(environment.runtime.navigator)
  })

  it('disposes the mount when the App leaves the page', async () => {
    const app = foreignApp()
    environment = createMfeTestEnvironment({ definitionId: 'shell', definitions: [app.definition] })

    const rendered = await renderSuspending(
      hosted(environment.runtime, <AppHost appId="reports" basePath="/reports" />),
    )
    await waitFor(() => {
      expect(app.targets).toHaveLength(1)
    })

    rendered.unmount()

    await waitFor(() => {
      expect(app.disposals).toBe(1)
    })
    expect(app.targets[0]?.context.signal.aborted).toBe(true)
  })

  it('shows a rejected mount in the fallback, and mounts again on retry', async () => {
    const app = foreignApp()
    app.failNextMount(new Error('NG04002: Cannot match any routes'))
    environment = createMfeTestEnvironment({ definitionId: 'shell', definitions: [app.definition] })

    await renderSuspending(
      hosted(
        environment.runtime,
        <AppHost appId="reports" basePath="/reports" fallback={retryable} />,
      ),
    )

    await waitFor(() => {
      expect(screen.getByTestId('error')).toHaveTextContent('NG04002')
    })

    await clickRetry()

    await waitFor(() => {
      expect(screen.getByTestId('foreign-app')).toBeInTheDocument()
    })
    expect(app.targets).toHaveLength(2)
  })
})
