import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, expect, it } from 'vitest'

import { stateCapabilities } from '@company/mfe-core/shared-state'
import type { StateRecord } from '@company/mfe-core/shared-state'
import { createMfeRuntime, createNoopTelemetryProvider, MfeProvider } from '@company/mfe-react/host'

import { MfeDevtools } from '../devtools-mount.tsx'
import { loadPanel } from '../load-panel.ts'
import { devtools } from '../devtools-store.ts'

const contract = {
  formatVersion: 1 as const,
  id: 'units',
  revision: 'v1',
  node: {
    kind: 'default' as const,
    value: 'metric',
    inner: { kind: 'enum' as const, values: ['metric', 'imperial'] },
  },
}
const requirements = {
  protocolVersion: 1 as const,
  contracts: [
    {
      id: contract.id,
      revision: contract.revision,
      capabilities: stateCapabilities(contract.node),
    },
  ],
}
let dispose: (() => void) | undefined

// Transforming the real lazy chunk belongs to setup, outside the live-update assertion window.
beforeAll(async () => {
  await loadPanel()
}, 30000)

afterEach(() => {
  devtools.disable()
  dispose?.()
  dispose = undefined
})

it('preserves the open dock, active tab, focus and value nodes through optimistic and confirmed writes', async () => {
  let accept!: (record: StateRecord) => void
  const created = createMfeRuntime({
    registryEntries: [],
    adapters: [],
    loader: {
      load: async () => {
        throw new Error('The inspector loads no containers')
      },
    },
    shellState: { user: null, groups: [], theme: 'light' },
    telemetryProvider: createNoopTelemetryProvider(),
    sharedState: {
      scope: 'test',
      schema: { formatVersion: 1, contracts: [contract] },
      adapter: {
        hydrate: async () => [{ id: 'units', revision: 0 }],
        write: () =>
          new Promise(resolve => {
            accept = resolve
          }),
      },
    },
  })
  dispose = created.dispose
  const state = created.runtime.sharedState!
  await state.prepare(requirements)
  const consumer = state.bind(requirements)
  const user = userEvent.setup()
  devtools.open('shared-state')
  await act(async () => {
    render(
      <MfeProvider runtime={created.runtime}>
        <MfeDevtools />
      </MfeProvider>,
    )
  })

  const tab = screen.getByRole('tab', { name: 'Shared State' })
  const current = screen.getByLabelText('current value of units')
  const panel = tab.closest('[data-mfe-devtools-panel]')!
  const attributes: MutationRecord[] = []
  const observer = new MutationObserver(records => attributes.push(...records))
  observer.observe(tab, { attributes: true })
  let write!: Promise<void>
  act(() => {
    write = consumer.set('units', 'imperial')
  })
  expect(screen.getByLabelText('current value of units')).toBe(current)
  expect(current.textContent).toBe('"imperial"')

  await user.click(screen.getByRole('tab', { name: 'Confirmed' }))
  const confirmedTab = screen.getByRole('tab', { name: 'Confirmed' })
  const confirmed = screen.getByLabelText('confirmed value of units')
  confirmed.scrollTop = 20
  expect(confirmed.textContent).toBe('"metric"')
  await act(async () => {
    accept({ id: 'units', revision: 1, value: 'imperial' })
    await write
  })
  expect(screen.getByLabelText('confirmed value of units')).toBe(confirmed)
  expect(confirmed.textContent).toBe('"imperial"')
  expect(confirmed.scrollTop).toBe(20)
  expect(confirmedTab.getAttribute('aria-selected')).toBe('true')
  expect(document.activeElement).toBe(confirmedTab)
  expect(screen.getByRole('tab', { name: 'Shared State' })).toBe(tab)
  expect(tab.closest('[data-mfe-devtools-panel]')).toBe(panel)
  expect(tab.getAttribute('aria-selected')).toBe('true')
  observer.disconnect()
  expect(attributes).toEqual([])
})
