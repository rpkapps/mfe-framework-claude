import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { stateCapabilities } from '@company/mfe-core/user-context'
import type {
  UserContextScopeService,
  UserContextResult,
  StateContract,
  StateRecord,
} from '@company/mfe-core/user-context'
import { UserContextRuntime } from '@company/mfe-runtime/user-context'

import { UserContextTab } from './user-context-tab.tsx'

const context = vi.hoisted(() => ({
  userContext: undefined as UserContextScopeService | undefined,
}))
vi.mock('@company/mfe-react', () => ({ useMfeRuntime: () => context }))
const contract: StateContract = {
  formatVersion: 1,
  id: 'units',
  revision: 'units-v1',
  node: {
    kind: 'object',
    strict: true,
    fields: {
      system: {
        kind: 'default',
        value: 'metric',
        inner: { kind: 'enum', values: ['metric', 'imperial'] },
      },
    },
  },
}
const requirements = {
  protocolVersion: 1 as const,
  ownerId: 'units',
  contracts: [
    {
      id: contract.id,
      revision: contract.revision,
      capabilities: stateCapabilities(contract.node),
    },
  ],
}
afterEach(() => {
  context.userContext?.dispose()
  context.userContext = undefined
})

function setup(
  write: () => Promise<StateRecord> = async () => ({
    id: 'units',
    revision: 1,
    value: { system: 'imperial' },
  }),
  contracts: readonly StateContract[] = [contract],
) {
  const hydrate = vi.fn(async (_scope: string, ids: readonly string[]) =>
    ids.map(id => ({ id, revision: 0 })),
  )
  const runtime = new UserContextRuntime({
    scope: 'private-scope',
    schema: { formatVersion: 1, contracts },
    adapter: { hydrate, write },
  })
  context.userContext = runtime
  return { runtime, hydrate }
}

describe('User Context tab', () => {
  it('explains an unconfigured runtime', () => {
    render(<UserContextTab />)
    expect(screen.getByText('User Context is not configured')).toBeTruthy()
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
    const view = render(<UserContextTab />)
    view.unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
  it('searches contracts and observes hydration without initiating it', async () => {
    const { runtime, hydrate } = setup()
    const user = userEvent.setup()
    render(<UserContextTab />)
    expect(hydrate).not.toHaveBeenCalled()
    expect(screen.getByText('Value has not been loaded')).toBeTruthy()
    await act(async () => {
      await runtime.prepare(requirements)
    })
    expect(screen.getByLabelText('current value of units').textContent).toContain('"metric"')
    await user.type(screen.getByLabelText('Search user-context owners'), 'missing')
    expect(screen.getByText('No owners match your search')).toBeTruthy()
    await user.clear(screen.getByLabelText('Search user-context owners'))
    expect(screen.getByRole('button', { name: 'Inspect units' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
    await user.click(screen.getByRole('tab', { name: 'Contract' }))
    expect(screen.getByLabelText('contract for units').textContent).toContain('units-v1')
  })
  it('groups local keys into one owner slice and excludes the authenticated scope', async () => {
    const owner: StateContract = {
      ...contract,
      id: 'operations',
      node: {
        kind: 'object',
        strict: true,
        fields: {
          units: { kind: 'default', value: 'metric', inner: { kind: 'string' } },
          selectedWell: {
            kind: 'default',
            value: null,
            inner: { kind: 'nullable', inner: { kind: 'string' } },
          },
        },
      },
    }
    const { runtime, hydrate } = setup(undefined, [owner])
    const view = render(<UserContextTab />)
    expect(screen.getAllByRole('button', { name: /^Inspect / })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Inspect operations' })).toBeTruthy()
    expect(hydrate).not.toHaveBeenCalled()
    await act(async () => {
      await runtime.prepare({
        protocolVersion: 1,
        ownerId: owner.id,
        contracts: [
          { id: owner.id, revision: owner.revision, capabilities: stateCapabilities(owner.node) },
        ],
      })
    })
    expect(JSON.parse(screen.getByLabelText('current value of operations').textContent)).toEqual({
      units: 'metric',
      selectedWell: null,
    })
    expect(view.container.textContent).not.toContain('private-scope')
  })
  it('finds namespaced keys before hydration and inspects only the committed nested value', async () => {
    const owner: StateContract = {
      ...contract,
      id: 'lab',
      node: {
        kind: 'object',
        strict: true,
        fields: {
          'well-selection': {
            kind: 'default',
            value: { wellId: 'well-42' },
            inner: {
              kind: 'object',
              strict: true,
              fields: { wellId: { kind: 'string' } },
            },
          },
          note: { kind: 'optional', inner: { kind: 'string' } },
        },
      },
    }
    const { runtime, hydrate } = setup(undefined, [owner, contract])
    const user = userEvent.setup()
    render(<UserContextTab />)
    await user.type(screen.getByLabelText('Search user-context owners'), 'lab:well-selection')
    expect(screen.getByRole('button', { name: 'Inspect lab' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Inspect units' })).toBeNull()
    await user.click(screen.getByRole('tab', { name: 'Keys' }))
    await user.click(screen.getByRole('button', { name: 'lab:well-selection' }))
    expect(screen.getByText('Value has not been loaded')).toBeTruthy()
    expect(hydrate).not.toHaveBeenCalled()
    await act(async () => {
      await runtime.prepare({
        protocolVersion: 1,
        ownerId: owner.id,
        contracts: [
          { id: owner.id, revision: owner.revision, capabilities: stateCapabilities(owner.node) },
        ],
      })
    })
    expect(
      JSON.parse(screen.getByLabelText('current value of lab:well-selection').textContent),
    ).toEqual({ wellId: 'well-42' })
    await user.click(screen.getByRole('button', { name: 'lab:note' }))
    expect(screen.getByText('Optional value is not set')).toBeTruthy()
  })
  it('shows persistence errors without replacing the committed local key value', async () => {
    const { runtime, hydrate } = setup(async () => {
      throw new Error('Storage is unavailable')
    })
    await runtime.prepare(requirements)
    let recover!: (records: { id: string; revision: number }[]) => void
    hydrate.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          recover = resolve
        }),
    )
    const user = userEvent.setup()
    render(<UserContextTab />)
    await user.click(screen.getByRole('tab', { name: 'Keys' }))
    await user.click(screen.getByRole('button', { name: 'units:system' }))
    await act(async () => {
      const result = await runtime.bind('units', requirements).set('system', 'imperial')
      expect(result.ok).toBe(false)
    })
    expect(screen.getAllByText('Write failed')).toHaveLength(2)
    expect(screen.getByRole('alert').textContent).toContain('Storage is unavailable')
    expect(screen.getByLabelText('current value of units:system').textContent).toBe('"metric"')
    await act(async () => recover([{ id: 'units', revision: 0 }]))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getAllByText('Ready')).toHaveLength(2)
  })
  it('shows pending writes only in the current value until commit and clears values on scope changes', async () => {
    let accept!: (record: StateRecord) => void
    const { runtime } = setup(
      () =>
        new Promise(resolve => {
          accept = resolve
        }),
    )
    await runtime.prepare(requirements)
    const user = userEvent.setup()
    const view = render(<UserContextTab />)
    let write!: Promise<UserContextResult<unknown>>
    act(() => {
      write = runtime.bind('units', requirements).set('system', 'imperial')
    })
    expect(screen.getByLabelText('current value of units').textContent).toContain('"imperial"')
    expect(screen.getAllByText('Pending')).toHaveLength(2)
    await user.click(screen.getByRole('tab', { name: 'Confirmed' }))
    expect(screen.getByLabelText('confirmed value of units').textContent).toContain('"metric"')
    await act(async () => {
      accept({ id: 'units', revision: 1, value: { system: 'imperial' } })
      await write
    })
    expect(screen.getByLabelText('confirmed value of units').textContent).toContain('"imperial"')
    act(() => runtime.setScope('other-scope'))
    expect(screen.getByText('Value has not been loaded')).toBeTruthy()
    expect(view.container.textContent).not.toContain('imperial')
    view.unmount()
  })
  it('makes the entire row clickable and supports arrow, Home and End navigation across 30 owners', async () => {
    setup(
      undefined,
      Array.from({ length: 30 }, (_, index) => ({
        ...contract,
        id: `owner-${String(index + 1).padStart(2, '0')}`,
      })),
    )
    const user = userEvent.setup()
    render(<UserContextTab />)
    const first = screen.getByRole('button', { name: 'Inspect owner-01' })
    const last = screen.getByRole('button', { name: 'Inspect owner-30' })
    // The badge and whitespace are inside the same button as the owner label.
    await user.click(last.querySelector('[data-slot="badge"]')!)
    expect(last.getAttribute('aria-pressed')).toBe('true')
    expect(last.getAttribute('tabindex')).toBe('0')
    expect(first.getAttribute('tabindex')).toBe('-1')
    await user.keyboard('{Home}{ArrowDown}')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Inspect owner-02' }))
    await user.keyboard('{End}{ArrowUp}')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Inspect owner-29' }))
    expect(
      screen.getByRole('button', { name: 'Inspect owner-29' }).getAttribute('aria-pressed'),
    ).toBe('true')
    await user.type(screen.getByLabelText('Search user-context owners'), 'owner-03')
    expect(screen.getByRole('button', { name: 'Inspect owner-03' }).getAttribute('tabindex')).toBe(
      '0',
    )
    // Filtering does not silently change the inspected owner.
    expect(screen.getByText('owner-29', { selector: 'h2' })).toBeTruthy()
  })
  it('selects an owner from the searchable narrow-dock picker without displaying a stacked list', async () => {
    setup(
      undefined,
      Array.from({ length: 30 }, (_, index) => ({
        ...contract,
        id: `owner-${String(index + 1).padStart(2, '0')}`,
      })),
    )
    const user = userEvent.setup()
    render(<UserContextTab />)
    await user.click(screen.getByRole('combobox', { name: 'Choose user-context owner' }))
    const input = await screen.findByLabelText('Find a user-context owner')
    await user.type(input, 'owner-30')
    await user.click(await screen.findByRole('option', { name: 'owner-30' }))
    expect(screen.getByText('owner-30', { selector: 'h2' })).toBeTruthy()
    await waitFor(() => expect(screen.queryByLabelText('Find a user-context owner')).toBeNull())
    await user.click(screen.getByLabelText('Choose user-context owner'))
    const reopenedInput = await screen.findByLabelText('Find a user-context owner')
    await user.clear(reopenedInput)
    await user.type(reopenedInput, 'missing')
    expect(screen.getByText('No owners match your search.')).toBeTruthy()
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText('Choose user-context owner')),
    )
  })
})
