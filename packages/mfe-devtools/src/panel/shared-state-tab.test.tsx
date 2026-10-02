import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { stateCapabilities } from '@company/mfe-core/shared-state'
import type {
  SharedStateScopeService,
  StateContract,
  StateRecord,
} from '@company/mfe-core/shared-state'
import { SharedStateRuntime } from '@company/mfe-runtime/shared-state'

import { SharedStateTab } from './shared-state-tab.tsx'

const context = vi.hoisted(() => ({
  sharedState: undefined as SharedStateScopeService | undefined,
}))
vi.mock('@company/mfe-react', () => ({ useMfeRuntime: () => context }))
const contract: StateContract = {
  formatVersion: 1,
  id: 'units',
  revision: 'units-v1',
  node: {
    kind: 'default',
    value: 'metric',
    inner: { kind: 'enum', values: ['metric', 'imperial'] },
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
afterEach(() => {
  context.sharedState?.dispose()
  context.sharedState = undefined
})

function setup(
  write: () => Promise<StateRecord> = async () => ({ id: 'units', revision: 1, value: 'imperial' }),
) {
  const hydrate = vi.fn(async () => [{ id: 'units', revision: 0 }])
  const runtime = new SharedStateRuntime({
    scope: 'private-scope',
    schema: { formatVersion: 1, contracts: [contract] },
    adapter: { hydrate, write },
  })
  context.sharedState = runtime
  return { runtime, hydrate }
}

describe('Shared State tab', () => {
  it('explains an unconfigured runtime', () => {
    render(<SharedStateTab />)
    expect(screen.getByText('Shared State is not configured')).toBeTruthy()
  })
  it('supports a custom service without diagnostics', () => {
    context.sharedState = {
      protocolVersion: 1,
      prepare: vi.fn(),
      bind: vi.fn(),
      setScope: vi.fn(),
      dispose: vi.fn(),
    }
    render(<SharedStateTab />)
    expect(screen.getByText('Inspection is unavailable')).toBeTruthy()
  })
  it('unsubscribes when the inspector unmounts', () => {
    const { runtime } = setup()
    const subscribe = runtime.inspection.subscribe
    const unsubscribe = vi.fn()
    vi.spyOn(runtime.inspection, 'subscribe').mockImplementation(listener => {
      const stop = subscribe(listener)
      return () => {
        stop()
        unsubscribe()
      }
    })
    const view = render(<SharedStateTab />)
    view.unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
  it('searches contracts and observes hydration without initiating it', async () => {
    const { runtime, hydrate } = setup()
    const user = userEvent.setup()
    render(<SharedStateTab />)
    expect(hydrate).not.toHaveBeenCalled()
    expect(screen.getByText('Value has not been loaded')).toBeTruthy()
    await act(async () => {
      await runtime.prepare(requirements)
    })
    expect(screen.getByLabelText('current value of units').textContent).toBe('"metric"')
    await user.type(screen.getByLabelText('Search shared-state contracts'), 'missing')
    expect(screen.getByText('No contracts match your search')).toBeTruthy()
    await user.clear(screen.getByLabelText('Search shared-state contracts'))
    expect(screen.getByRole('button', { name: 'Inspect units' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
    await user.click(screen.getByRole('tab', { name: 'Contract' }))
    expect(screen.getByLabelText('contract for units').textContent).toContain('units-v1')
  })
  it('keeps optimistic and confirmed values distinct and clears values on scope changes', async () => {
    let accept!: (record: StateRecord) => void
    const { runtime } = setup(
      () =>
        new Promise(resolve => {
          accept = resolve
        }),
    )
    await runtime.prepare(requirements)
    const user = userEvent.setup()
    const view = render(<SharedStateTab />)
    let write!: Promise<void>
    act(() => {
      write = runtime.bind(requirements).set('units', 'imperial')
    })
    expect(screen.getByLabelText('current value of units').textContent).toBe('"imperial"')
    expect(screen.getAllByText('Pending')).toHaveLength(2)
    await user.click(screen.getByRole('tab', { name: 'Confirmed' }))
    expect(screen.getByLabelText('confirmed value of units').textContent).toBe('"metric"')
    await act(async () => {
      accept({ id: 'units', revision: 1, value: 'imperial' })
      await write
    })
    expect(screen.getByLabelText('confirmed value of units').textContent).toBe('"imperial"')
    act(() => runtime.setScope('other-scope'))
    expect(screen.getByText('Value has not been loaded')).toBeTruthy()
    expect(view.container.textContent).not.toContain('imperial')
    view.unmount()
  })
})
