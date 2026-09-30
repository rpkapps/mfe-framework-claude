import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'
import { z } from 'zod'

import { createMemoryRuntime, type MemoryRuntime } from '@company/mfe-runtime/testing'
import { createMountContext } from '@company/mfe-runtime'
import { MfeMountProvider } from '../mount-context.tsx'
import { MfeProvider } from '../runtime-context.tsx'
import { withQueryClient } from '../runtime.ts'
import { createWidget } from '../definition.ts'
import { DynamicWidget } from '../lazy-widget.tsx'
import { useStoredState, type StoredStateSetter } from './use-stored-state.ts'

const schema = z.number()
let memory: MemoryRuntime | undefined
const setters = new Map<string, StoredStateSetter<number>>()

afterEach(() => {
  memory?.dispose()
  setters.clear()
})

function Tile({ name }: { readonly name: string }): ReactNode {
  const [zoom, setZoom] = useStoredState('zoom', schema, { defaultValue: 1, scope: 'instance' })
  setters.set(name, setZoom)
  return <output data-testid={name}>{zoom}</output>
}

const chart = createWidget({
  id: 'chart',
  inputSchema: z.strictObject({ label: z.string() }),
  outputSchema: z.object({}),
  render: ({ inputs }) => <Tile name={inputs.label} />,
})

describe('useStoredState instance scope', () => {
  it('uses the public Widget host ID, filters it out of inputs, and restores its state after an ID change', async () => {
    memory = createMemoryRuntime({ definitions: [chart] })
    const { runtime } = memory
    const page = (instanceId: string) => (
      <MfeProvider runtime={runtime}>
        <DynamicWidget widgetId="chart" instanceId={instanceId} label="north" />
        <DynamicWidget widgetId="chart" instanceId="south" label="south" />
      </MfeProvider>
    )
    const view = render(page('north'))
    await screen.findByTestId('north')
    await screen.findByTestId('south')
    act(() => setters.get('north')?.(4))
    expect(screen.getByTestId('north')).toHaveTextContent('4')
    expect(screen.getByTestId('south')).toHaveTextContent('1')

    view.rerender(page('west'))
    await waitFor(() => expect(screen.getByTestId('north')).toHaveTextContent('1'))
    view.rerender(page('north'))
    await waitFor(() => expect(screen.getByTestId('north')).toHaveTextContent('4'))
    view.unmount()
  })

  it('isolates duplicate tiles and restores a stable tile after its mount is replaced', async () => {
    memory = createMemoryRuntime()
    const { runtime } = memory
    const options = { runtime, definitionId: 'chart', kind: 'widget' as const }
    const north = createMountContext({ ...options, instanceId: 'north' })
    const south = createMountContext({ ...options, instanceId: 'south' })
    const northMount = withQueryClient(north.context)
    const southMount = withQueryClient(south.context)
    const page = (n = northMount) => (
      <MfeProvider runtime={runtime}>
        <MfeMountProvider mount={n}>
          <Tile name="north" />
        </MfeMountProvider>
        <MfeMountProvider mount={southMount}>
          <Tile name="south" />
        </MfeMountProvider>
      </MfeProvider>
    )
    const view = render(page())
    act(() => setters.get('north')?.(4))
    expect(screen.getByTestId('north')).toHaveTextContent('4')
    expect(screen.getByTestId('south')).toHaveTextContent('1')

    await north.dispose()
    const fresh = createMountContext({ ...options, instanceId: 'north' })
    view.rerender(page(withQueryClient(fresh.context)))
    expect(fresh.context.mountToken).not.toBe(north.context.mountToken)
    expect(screen.getByTestId('north')).toHaveTextContent('4')
    view.unmount()
    await fresh.dispose()
    await south.dispose()
  })

  it('rejects instance state inside a widget with no stable ID and outside any mount', () => {
    memory = createMemoryRuntime()
    const { runtime } = memory
    const mount = createMountContext({ runtime, definitionId: 'chart', kind: 'widget' })
    expect(() =>
      render(
        <MfeProvider runtime={runtime}>
          <MfeMountProvider mount={withQueryClient(mount.context)}>
            <Tile name="missing" />
          </MfeMountProvider>
        </MfeProvider>,
      ),
    ).toThrow(/instanceId/)
    expect(() =>
      render(
        <MfeProvider runtime={runtime}>
          <Tile name="host" />
        </MfeProvider>,
      ),
    ).toThrow(/instanceId/)
    expect(memory.storageAreas.local.snapshot()).toEqual({})
  })
})
