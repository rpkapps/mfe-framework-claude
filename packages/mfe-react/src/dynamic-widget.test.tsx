/**
 * Consuming a Widget whose id is a value: `lazyWidget`'s module-scope rule is unfollowable when
 * the ids come from a registry fetched at boot (§15).
 */

import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Suspense, useState, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createWidget } from './definition.ts'
import { DynamicWidget } from './lazy-widget.tsx'
import { MfeProvider } from './runtime-context.tsx'
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

const counter = createWidget({
  id: 'counter-widget',
  version: '1.0.0',
  inputs: z.object({ label: z.string() }),
  events: { bumped: z.object({ at: z.string() }) },
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
  inputs: z.object({ label: z.string() }),
  events: { opened: z.object({ at: z.string() }), closed: z.object({ at: z.string() }) },
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
  inputs: z.object({}),
  events: { event: z.object({ n: z.number() }) },
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
  inputs: z.object({ label: z.string() }),
  events: {},
  render: ({ inputs }) => <p data-testid="other">{inputs.label}</p>,
})

function hosted(runtime: MfeTestEnvironment['runtime'], children: ReactNode): ReactNode {
  return (
    <MfeProvider runtime={runtime}>
      <Suspense fallback={null}>{children}</Suspense>
    </MfeProvider>
  )
}

describe('DynamicWidget', () => {
  it('mounts the Widget named by its prop', async () => {
    environment = createMfeTestEnvironment({ definitionId: 'host', definitions: [counter] })

    await renderSuspending(
      hosted(environment.runtime, <DynamicWidget widgetId="counter-widget" label="Clicks" />),
    )

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

    await renderSuspending(hosted(environment.runtime, <Host />))

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

    await renderSuspending(
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

    await renderSuspending(
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

    await renderSuspending(
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

    await renderSuspending(
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
describe('DynamicWidget onEvent', () => {
  it('delivers every declared event, by name, to one handler', async () => {
    environment = createMfeTestEnvironment({ definitionId: 'host', definitions: [feed] })
    const onEvent = vi.fn()

    await renderSuspending(
      hosted(
        environment.runtime,
        <DynamicWidget widgetId="feed-widget" label="Feed" onEvent={onEvent} />,
      ),
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'open' })).toBeInTheDocument()
    })
    await userEvent.click(screen.getByRole('button', { name: 'open' }))
    await userEvent.click(screen.getByRole('button', { name: 'close' }))

    expect(onEvent.mock.calls).toEqual([
      ['opened', { at: 'now' }],
      ['closed', { at: 'later' }],
    ])
  })

  it('delivers an event to its own handler and to the catch-all', async () => {
    environment = createMfeTestEnvironment({ definitionId: 'host', definitions: [feed] })
    const onEvent = vi.fn()
    const onOpened = vi.fn()

    await renderSuspending(
      hosted(
        environment.runtime,
        <DynamicWidget widgetId="feed-widget" label="Feed" onOpened={onOpened} onEvent={onEvent} />,
      ),
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'open' })).toBeInTheDocument()
    })
    await userEvent.click(screen.getByRole('button', { name: 'open' }))

    // A consumer asking for all of them and for one in particular means both.
    expect(onOpened).toHaveBeenCalledWith({ at: 'now' })
    expect(onEvent).toHaveBeenCalledWith('opened', { at: 'now' })
  })

  it('never forwards the catch-all to the provider as an input', async () => {
    environment = createMfeTestEnvironment({ definitionId: 'host', definitions: [counter] })

    await renderSuspending(
      hosted(
        environment.runtime,
        <DynamicWidget
          widgetId="counter-widget"
          label="Clicks"
          onEvent={() => undefined}
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
    const onEvent = vi.fn()

    await renderSuspending(
      hosted(environment.runtime, <DynamicWidget widgetId="collides-widget" onEvent={onEvent} />),
    )

    await waitFor(() => {
      expect(screen.getByRole('button')).toBeInTheDocument()
    })
    await userEvent.click(screen.getByRole('button'))

    // The prop is the catch-all's, so this Widget cannot be subscribed to by prop name.
    expect(onEvent).toHaveBeenCalledWith('event', { n: 1 })
  })
})
