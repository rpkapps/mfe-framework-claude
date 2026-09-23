/**
 * `mountApp` and `mountWidget` place a definition the way a host does, through the runtime's
 * `mountDefinition`, so a test sees the host's side of the contract: the scope root, the events
 * that reached the host, and a rejected mount as a rejection.
 */

import { SCOPE_ATTRIBUTE } from '@company/mfe-runtime'
import { createRootRoute, createRouter } from '@tanstack/react-router'
import { waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { createApp, createWidget } from '../definition.ts'
import { createMemoryRuntime, mountApp, mountWidget } from './index.tsx'

const counter = createWidget({
  id: 'counter-widget',
  version: '1.0.0',
  inputs: z.object({ label: z.string() }),
  events: { bumped: z.object({ at: z.string() }) },
  render: ({ inputs, emit }): ReactNode => (
    <button
      type="button"
      onClick={() => {
        emit('bumped', { at: 'now' })
      }}
    >
      {inputs.label}
    </button>
  ),
})

const reports = createApp({
  id: 'reports',
  router: ({ basePath, history, context }) =>
    createRouter({
      routeTree: createRootRoute({ component: () => <p>Reports</p> }),
      basepath: basePath,
      history,
      context: { ...context },
    }),
})

describe('mountWidget', () => {
  it('mounts inside the runtime’s scope root and records the events that reached the host', async () => {
    const mounted = await mountWidget(counter, { inputs: { label: 'Clicks' } })

    const button = within(mounted.element).getByRole('button')
    expect(button.closest(`[${SCOPE_ATTRIBUTE}]`)?.getAttribute(SCOPE_ATTRIBUTE)).toBe(
      'counter-widget',
    )

    button.click()
    await waitFor(() => {
      expect(mounted.events).toEqual([{ name: 'bumped', payload: { at: 'now' } }])
    })

    await mounted.dispose()
    expect(mounted.element.isConnected).toBe(false)
  })

  it('hands an update to the mount it has', async () => {
    const mounted = await mountWidget(counter, { inputs: { label: 'Clicks' } })

    mounted.update({ label: 'Taps' })

    await waitFor(() => {
      expect(within(mounted.element).getByRole('button')).toHaveTextContent('Taps')
    })
    expect(mounted.mount.state.status).toBe('mounted')
    await mounted.dispose()
  })

  it('rejects with the provider’s error when the first inputs fail its contract', async () => {
    const failure = await mountWidget(counter, { inputs: { label: 7 } }).catch(
      (error: unknown) => error,
    )

    expect(failure).toMatchObject({ code: 'contract/input-mismatch', id: 'counter-widget' })
  })
})

describe('mountApp', () => {
  it('mounts at its boundary, over a history that starts there', async () => {
    const mounted = await mountApp(reports, { basePath: '/reports' })

    expect(await within(mounted.element).findByText('Reports')).toBeInTheDocument()
    expect(mounted.mount.context?.basePath).toBe('/reports')
    await mounted.dispose()
  })

  it('mounts into a runtime the test owns, and leaves it alive', async () => {
    const memory = createMemoryRuntime({ definitions: [reports], initialEntries: ['/reports'] })

    const mounted = await mountApp(reports, { memory, basePath: '/reports' })
    await mounted.dispose()

    expect(memory.runtime.registry.entries.has('reports')).toBe(true)
    memory.dispose()
  })
})
