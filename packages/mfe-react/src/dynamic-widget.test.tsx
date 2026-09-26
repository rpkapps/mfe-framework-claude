/**
 * Consuming a Widget whose id is a value: `lazyWidget`'s module-scope rule is unfollowable when
 * the ids come from a registry fetched at boot (§15).
 */

import { KIND_ATTRIBUTE, MOUNT_ATTRIBUTE, SCOPE_ATTRIBUTE } from '@company/mfe-runtime'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode, useState, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { alertContract, domWidget } from './__tests__/dom-definitions.ts'
import { createWidget } from './definition.ts'
import { DynamicWidget, lazyWidget } from './lazy-widget.tsx'
import { MfeProvider } from './runtime-context.tsx'
import { createMfeTestEnvironment, type MfeTestEnvironment } from './testing/index.tsx'

let environment: MfeTestEnvironment | null = null

afterEach(async () => {
  const current = environment
  environment = null
  await current?.dispose()
})

const counter = createWidget({
  id: 'counter-widget',
  version: '1.0.0',
  inputSchema: z.object({ label: z.string() }),
  outputSchema: z.object({ bumped: z.object({ at: z.string() }) }),
  render: function Counter({ inputs, emit }): ReactNode {
    const [clicks, setClicks] = useState(0)
    return (
      <button
        type="button"
        onClick={() => {
          setClicks(current => current + 1)
          emit('bumped', { at: 'now' })
        }}
      >
        {inputs.label}: {clicks}
      </button>
    )
  },
})

const feed = createWidget({
  id: 'feed-widget',
  version: '1.0.0',
  inputSchema: z.object({ label: z.string() }),
  outputSchema: z.object({
    opened: z.object({ at: z.string() }),
    closed: z.object({ at: z.string() }),
  }),
  render: ({ inputs, emit }): ReactNode => (
    <>
      <span>{inputs.label}</span>
      <button
        type="button"
        onClick={() => {
          emit('opened', { at: 'now' })
        }}
      >
        open
      </button>
      <button
        type="button"
        onClick={() => {
          emit('closed', { at: 'later' })
        }}
      >
        close
      </button>
    </>
  ),
})

/** A Widget whose one event is called `event`, which maps to the catch-all's own prop name. */
const collides = createWidget({
  id: 'collides-widget',
  version: '1.0.0',
  inputSchema: z.object({}),
  outputSchema: z.object({ event: z.object({ n: z.number() }) }),
  render: ({ emit }): ReactNode => (
    <button
      type="button"
      onClick={() => {
        emit('event', { n: 1 })
      }}
    >
      emit
    </button>
  ),
})

const other = createWidget({
  id: 'other-widget',
  version: '2.0.0',
  inputSchema: z.object({ label: z.string() }),
  outputSchema: z.object({}),
  render: ({ inputs }) => <p data-testid="other">{inputs.label}</p>,
})

function hosted(runtime: MfeTestEnvironment['runtime'], children: ReactNode): ReactNode {
  return <MfeProvider runtime={runtime}>{children}</MfeProvider>
}

describe('DynamicWidget', () => {
  it('mounts the Widget named by its prop', async () => {
    environment = createMfeTestEnvironment({ definitionId: 'host', definitions: [counter] })

    render(hosted(environment.runtime, <DynamicWidget widgetId="counter-widget" label="Clicks" />))

    await waitFor(() => {
      expect(screen.getByRole('button')).toHaveTextContent('Clicks: 0')
    })
  })

  /** A `lazyWidget` call during render hands React a new component type on every pass (§15). */
  it('keeps the Widget mounted, and its state, across host re-renders', async () => {
    environment = createMfeTestEnvironment({ definitionId: 'host', definitions: [counter] })

    function Host(): ReactNode {
      const [renders, setRenders] = useState(0)
      return (
        <>
          <button
            type="button"
            data-testid="rerender"
            onClick={() => {
              setRenders(current => current + 1)
            }}
          >
            re-render {renders}
          </button>
          <DynamicWidget widgetId="counter-widget" label="Clicks" />
        </>
      )
    }

    render(hosted(environment.runtime, <Host />))

    await waitFor(() => {
      expect(screen.getByText(/Clicks:/)).toBeInTheDocument()
    })

    await userEvent.click(screen.getByText(/Clicks:/))
    expect(screen.getByText('Clicks: 1')).toBeInTheDocument()

    await userEvent.click(screen.getByTestId('rerender'))
    await userEvent.click(screen.getByTestId('rerender'))

    // Still 1: the host re-rendered twice and the Widget was never replaced.
    expect(screen.getByText('Clicks: 1')).toBeInTheDocument()
  })

  it('routes a declared event to the matching onX prop', async () => {
    environment = createMfeTestEnvironment({ definitionId: 'host', definitions: [counter] })
    const onBumped = vi.fn()

    render(
      hosted(
        environment.runtime,
        <DynamicWidget widgetId="counter-widget" label="Clicks" onBumped={onBumped} />,
      ),
    )

    await waitFor(() => {
      expect(screen.getByRole('button')).toBeInTheDocument()
    })
    await userEvent.click(screen.getByRole('button'))

    // The provider validated, and the event reached a handler never typed against it.
    expect(onBumped).toHaveBeenCalledWith({ at: 'now' })
  })

  it('mounts two different ids independently', async () => {
    environment = createMfeTestEnvironment({
      definitionId: 'host',
      definitions: [counter, other],
    })

    render(
      hosted(
        environment.runtime,
        <>
          <DynamicWidget widgetId="counter-widget" label="Clicks" />
          <DynamicWidget widgetId="other-widget" label="Other" />
        </>,
      ),
    )

    await waitFor(() => {
      expect(screen.getByTestId('other')).toHaveTextContent('Other')
    })
    expect(screen.getByRole('button')).toHaveTextContent('Clicks: 0')
  })

  it('rejects an input the provider does not accept, at the provider', async () => {
    environment = createMfeTestEnvironment({ definitionId: 'host', definitions: [counter] })

    render(
      hosted(
        environment.runtime,
        <DynamicWidget
          widgetId="counter-widget"
          label={7}
          fallback={({ error }) => <p data-testid="error">{error.message}</p>}
        />,
      ),
    )

    await waitFor(() => {
      expect(screen.getByTestId('error')).toHaveTextContent('counter-widget')
    })
    // Contract-free means no consumer types, not a weaker boundary: the provider named the field.
    expect(screen.getByTestId('error')).toHaveTextContent('label')
  })

  it('reports an id that is not registered, with a retry', async () => {
    environment = createMfeTestEnvironment({ definitionId: 'host', definitions: [] })

    render(
      hosted(
        environment.runtime,
        <DynamicWidget
          widgetId="not-registered"
          fallback={({ error }) => <p data-testid="error">{error.message}</p>}
        />,
      ),
    )

    await waitFor(() => {
      expect(screen.getByTestId('error')).toHaveTextContent('not-registered')
    })
  })
})

/** A host knows a Widget's events only as the strings its published contract lists (§28). */
describe('DynamicWidget onOutput', () => {
  it('delivers every declared event, by name, to one handler', async () => {
    environment = createMfeTestEnvironment({ definitionId: 'host', definitions: [feed] })
    const onOutput = vi.fn()

    render(
      hosted(
        environment.runtime,
        <DynamicWidget widgetId="feed-widget" label="Feed" onOutput={onOutput} />,
      ),
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'open' })).toBeInTheDocument()
    })
    await userEvent.click(screen.getByRole('button', { name: 'open' }))
    await userEvent.click(screen.getByRole('button', { name: 'close' }))

    expect(onOutput.mock.calls).toEqual([
      ['opened', { at: 'now' }],
      ['closed', { at: 'later' }],
    ])
  })

  it('delivers an event to its own handler and to the catch-all', async () => {
    environment = createMfeTestEnvironment({ definitionId: 'host', definitions: [feed] })
    const onOutput = vi.fn()
    const onOpened = vi.fn()

    render(
      hosted(
        environment.runtime,
        <DynamicWidget
          widgetId="feed-widget"
          label="Feed"
          onOpened={onOpened}
          onOutput={onOutput}
        />,
      ),
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'open' })).toBeInTheDocument()
    })
    await userEvent.click(screen.getByRole('button', { name: 'open' }))

    // A consumer asking for all of them and for one in particular means both.
    expect(onOpened).toHaveBeenCalledWith({ at: 'now' })
    expect(onOutput).toHaveBeenCalledWith('opened', { at: 'now' })
  })

  it('never forwards the catch-all to the provider as an input', async () => {
    environment = createMfeTestEnvironment({ definitionId: 'host', definitions: [counter] })

    render(
      hosted(
        environment.runtime,
        <DynamicWidget
          widgetId="counter-widget"
          label="Clicks"
          onOutput={() => undefined}
          fallback={({ error }) => <p data-testid="error">{error.message}</p>}
        />,
      ),
    )

    // Inputs are validated as serializable, so a function would have been rejected, not ignored.
    await waitFor(() => {
      expect(screen.getByRole('button')).toHaveTextContent('Clicks: 0')
    })
    expect(screen.queryByTestId('error')).not.toBeInTheDocument()
  })

  it('still delivers an event whose name maps to the catch-all prop', async () => {
    environment = createMfeTestEnvironment({ definitionId: 'host', definitions: [collides] })
    const onOutput = vi.fn()

    render(
      hosted(environment.runtime, <DynamicWidget widgetId="collides-widget" onOutput={onOutput} />),
    )

    await waitFor(() => {
      expect(screen.getByRole('button')).toBeInTheDocument()
    })
    await userEvent.click(screen.getByRole('button'))

    // The prop is the catch-all's, so this Widget cannot be subscribed to by prop name.
    expect(onOutput).toHaveBeenCalledWith('event', { n: 1 })
  })
})

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

/**
 * A Widget no framework in the repository built, placed exactly as a React one is: inputs, events,
 * retry and disposal all go through the runtime's mount, never through a React tree.
 */
describe('a Widget any framework built', () => {
  it('mounts itself into an element inside a scope root the runtime made', async () => {
    const widget = domWidget()
    environment = createMfeTestEnvironment({
      definitionId: 'host',
      definitions: [widget.definition],
    })

    render(hosted(environment.runtime, <DynamicWidget widgetId="alert-panel" label="Disk full" />))

    expect(await screen.findByTestId('dom-label')).toHaveTextContent('Disk full')
    const target = widget.targets[0]
    const scopeRoot = target?.element.closest(`[${SCOPE_ATTRIBUTE}]`)
    expect(scopeRoot?.getAttribute(SCOPE_ATTRIBUTE)).toBe('alert-panel')
    expect(scopeRoot?.getAttribute(MOUNT_ATTRIBUTE)).toBe(target?.context.mountToken)
    expect(scopeRoot?.getAttribute(KIND_ATTRIBUTE)).toBe('widget')
    expect(target?.context).toMatchObject({ definitionId: 'alert-panel', kind: 'widget' })
    expect(target?.inputs).toEqual({ label: 'Disk full' })
  })

  it('hands a changed input to the mount it has rather than mounting again', async () => {
    const widget = domWidget()
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

    render(hosted(environment.runtime, <Host />))
    await screen.findByTestId('dom-label')

    await userEvent.click(screen.getByRole('button', { name: 'change' }))

    expect(screen.getByTestId('dom-label')).toHaveTextContent('Disk cleared')
    expect(widget.updates).toEqual([{ label: 'Disk cleared' }])
    expect(widget.targets).toHaveLength(1)
  })

  it('does not hand over inputs equal to the ones it already has', async () => {
    const widget = domWidget()
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

    render(hosted(environment.runtime, <Host />))
    await screen.findByTestId('dom-label')

    await userEvent.click(screen.getByRole('button', { name: /re-render/ }))
    await userEvent.click(screen.getByRole('button', { name: /re-render/ }))

    // New props objects and a new handler each time, and still nothing for the provider to do.
    expect(widget.updates).toEqual([])
    expect(widget.targets).toHaveLength(1)
  })

  it('delivers inputs that changed while the mount was pending once it settles', async () => {
    const widget = domWidget({ settleManually: true })
    environment = createMfeTestEnvironment({
      definitionId: 'host',
      definitions: [widget.definition],
    })

    const rendered = render(
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

    await waitFor(() => {
      expect(widget.updates).toEqual([{ label: 'Disk cleared' }])
    })
    expect(widget.targets[0]?.inputs).toEqual({ label: 'Disk full' })
    expect(screen.getByTestId('dom-label')).toHaveTextContent('Disk cleared')
  })

  it('routes an event the provider emits to its onX handler and to the catch-all', async () => {
    const widget = domWidget()
    environment = createMfeTestEnvironment({
      definitionId: 'host',
      definitions: [widget.definition],
    })
    const onAcknowledged = vi.fn()
    const onOutput = vi.fn()

    render(
      hosted(
        environment.runtime,
        <DynamicWidget
          widgetId="alert-panel"
          label="Disk full"
          onAcknowledged={onAcknowledged}
          onOutput={onOutput}
        />,
      ),
    )
    await screen.findByTestId('dom-label')

    widget.emit('acknowledged', { alertId: 'a-1' })

    expect(onAcknowledged).toHaveBeenCalledWith({ alertId: 'a-1' })
    expect(onOutput).toHaveBeenCalledWith('acknowledged', { alertId: 'a-1' })
  })

  it('reaches the handler committed last, without mounting again', async () => {
    const widget = domWidget()
    environment = createMfeTestEnvironment({
      definitionId: 'host',
      definitions: [widget.definition],
    })
    const first = vi.fn()
    const second = vi.fn()

    const rendered = render(
      hosted(
        environment.runtime,
        <DynamicWidget widgetId="alert-panel" label="Disk full" onAcknowledged={first} />,
      ),
    )
    await screen.findByTestId('dom-label')
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
    const widget = domWidget()
    environment = createMfeTestEnvironment({
      definitionId: 'host',
      definitions: [widget.definition],
    })
    const AlertPanel = lazyWidget('alert-panel', {
      contract: {
        inputSchema: alertContract.inputSchema,
        outputSchema: z.object({
          acknowledged: z.object({ alertId: z.string().startsWith('alert-') }),
        }),
      },
    })
    const onAcknowledged = vi.fn()

    render(
      hosted(environment.runtime, <AlertPanel label="Disk full" onAcknowledged={onAcknowledged} />),
    )
    await screen.findByTestId('dom-label')

    expect(() => {
      widget.emit('acknowledged', { alertId: 'a-1' })
    }).not.toThrow()
    widget.emit('acknowledged', { alertId: 'alert-2' })

    expect(onAcknowledged.mock.calls).toEqual([[{ alertId: 'alert-2' }]])
    expect(environment.diagnostics).toHaveLength(1)
    expect(environment.diagnostics[0]?.error).toMatchObject({
      code: 'contract/output-mismatch',
      id: 'alert-panel',
    })
  })

  it('disposes the mount when the Widget leaves the page', async () => {
    const widget = domWidget()
    environment = createMfeTestEnvironment({
      definitionId: 'host',
      definitions: [widget.definition],
    })

    const rendered = render(
      hosted(environment.runtime, <DynamicWidget widgetId="alert-panel" label="Disk full" />),
    )
    await screen.findByTestId('dom-label')
    const signal = widget.targets[0]?.context.signal

    rendered.unmount()

    await waitFor(() => {
      expect(widget.disposals).toBe(1)
    })
    expect(signal?.aborted).toBe(true)
    expect(screen.queryByTestId('dom-label')).not.toBeInTheDocument()
  })

  /** Nothing is left to dispose it later, so it is disposed the moment it arrives. */
  it('disposes a mount that settles after the Widget already left the page', async () => {
    const widget = domWidget({ settleManually: true })
    environment = createMfeTestEnvironment({
      definitionId: 'host',
      definitions: [widget.definition],
    })

    const rendered = render(
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

    await waitFor(() => {
      expect(widget.disposals).toBe(1)
    })
    expect(widget.updates).toEqual([])
  })

  /** StrictMode disposes the first mount before its load settles,, so `mount` runs once. */
  it('mounts the Widget exactly once under StrictMode', async () => {
    const widget = domWidget()
    environment = createMfeTestEnvironment({
      definitionId: 'host',
      definitions: [widget.definition],
    })

    render(
      <StrictMode>
        {hosted(environment.runtime, <DynamicWidget widgetId="alert-panel" label="Disk full" />)}
      </StrictMode>,
    )

    await screen.findByTestId('dom-label')
    expect(screen.getAllByTestId('dom-label')).toHaveLength(1)
    expect(widget.targets).toHaveLength(1)
    expect(widget.disposals).toBe(0)
  })

  it('shows a rejected mount in the fallback, and mounts again on retry', async () => {
    const widget = domWidget()
    widget.failNextMount(new Error('NG0303: Can’t set value of the label input'))
    environment = createMfeTestEnvironment({
      definitionId: 'host',
      definitions: [widget.definition],
    })

    render(
      hosted(
        environment.runtime,
        <DynamicWidget widgetId="alert-panel" label="Disk full" fallback={retryable} />,
      ),
    )

    expect(await screen.findByTestId('error')).toHaveTextContent('NG0303')
    expect(screen.getByTestId('error')).toHaveTextContent('alert-panel')

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByTestId('dom-label')).toHaveTextContent('Disk full')
    expect(widget.targets).toHaveLength(2)
    expect(screen.queryByTestId('error')).not.toBeInTheDocument()
  })

  it('shows what it was given while the Widget is pending', async () => {
    const widget = domWidget({ settleManually: true })
    environment = createMfeTestEnvironment({
      definitionId: 'host',
      definitions: [widget.definition],
    })

    render(
      hosted(
        environment.runtime,
        <DynamicWidget widgetId="alert-panel" label="Disk full" pending={<p>Loading alerts</p>} />,
      ),
    )

    expect(screen.getByText('Loading alerts')).toBeInTheDocument()
    await waitFor(() => {
      expect(widget.settlements).toHaveLength(1)
    })
    await act(async () => {
      widget.settlements[0]?.resolve()
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.queryByText('Loading alerts')).not.toBeInTheDocument()
    })
    expect(screen.getByTestId('dom-label')).toHaveTextContent('Disk full')
  })
})
