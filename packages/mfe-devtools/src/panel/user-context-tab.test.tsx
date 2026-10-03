import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import type {
  Json,
  StateRecord,
  UserContextOwner,
  UserContextResult,
} from '@company/mfe-core/user-context'
import { UserContextRuntime } from '@company/mfe-runtime/user-context'

import { UserContextTab } from './user-context-tab.tsx'

const context = vi.hoisted(() => ({
  userContext: undefined as UserContextRuntime | undefined,
}))
vi.mock('@company/mfe-react', () => ({ useMfeRuntime: () => context }))
const units: UserContextOwner = {
  id: 'units',
  userContext: {
    schema: z.strictObject({ system: z.enum(['metric', 'imperial']).default('metric') }),
  },
}
afterEach(() => {
  context.userContext?.dispose()
  context.userContext = undefined
})

function setup(
  stored: Readonly<Record<string, Json>> = {},
  write: () => Promise<StateRecord> = async () => ({
    id: 'units',
    revision: 1,
    value: { system: 'imperial' },
  }),
) {
  const hydrate = vi.fn(async (ids: readonly string[]): Promise<readonly StateRecord[]> =>
    ids.map(id => (id in stored ? { id, revision: 1, value: stored[id]! } : { id, revision: 0 })),
  )
  const runtime = new UserContextRuntime({ adapter: { hydrate, write } })
  context.userContext = runtime
  return { runtime, hydrate }
}
function owners(count: number): Promise<void> {
  return act(async () => {
    await Promise.all(
      Array.from({ length: count }, (_, index) =>
        context.userContext!.prepare({
          ...units,
          id: `owner-${String(index + 1).padStart(2, '0')}`,
        }),
      ),
    )
  })
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
  it('lists an owner once a page loads it, searches owners and shows its schema', async () => {
    const { runtime, hydrate } = setup({ units: { system: 'imperial' } })
    const user = userEvent.setup()
    render(<UserContextTab />)
    expect(screen.getByText('No user-context owners loaded')).toBeTruthy()
    expect(hydrate).not.toHaveBeenCalled()
    await act(async () => {
      await runtime.prepare(units)
    })
    expect(screen.getByLabelText('value of units').textContent).toContain('"imperial"')
    expect(screen.getByText('Record revision 1')).toBeTruthy()
    await user.type(screen.getByLabelText('Search user-context owners'), 'missing')
    expect(screen.getByText('No owners match your search')).toBeTruthy()
    await user.clear(screen.getByLabelText('Search user-context owners'))
    expect(screen.getByRole('button', { name: 'Inspect units' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
    await user.click(screen.getByRole('tab', { name: 'Schema' }))
    const schema = JSON.parse(screen.getByLabelText('schema for units').textContent) as {
      properties: Record<string, unknown>
    }
    expect(schema.properties['system']).toMatchObject({ enum: ['metric', 'imperial'] })
  })
  it('lists the schema fields and stored keys of an owner, and says which are not stored', async () => {
    const operations: UserContextOwner = {
      id: 'operations',
      userContext: {
        schema: z.object({
          units: z.string().default('metric'),
          selectedWell: z.string().nullable().default(null),
        }),
      },
    }
    const { runtime } = setup({ operations: { units: 'imperial', retired: true } })
    const user = userEvent.setup()
    await runtime.prepare(operations)
    render(<UserContextTab />)
    await user.click(screen.getByRole('tab', { name: 'Keys' }))
    expect(
      screen.getAllByRole('button', { name: /^operations:/ }).map(button => button.textContent),
    ).toEqual(['operations:retired', 'operations:selectedWell', 'operations:units'])
    await user.click(screen.getByRole('button', { name: 'operations:units' }))
    expect(screen.getByLabelText('value of operations:units').textContent).toBe('"imperial"')
    await user.click(screen.getByRole('button', { name: 'operations:selectedWell' }))
    expect(screen.getByText('Value is not stored')).toBeTruthy()
  })
  it('finds an owner by a namespaced key and inspects the nested stored value', async () => {
    const lab: UserContextOwner = {
      id: 'lab',
      userContext: {
        schema: z.strictObject({
          'well-selection': z.strictObject({ wellId: z.string() }).nullable().default(null),
          note: z.string().optional(),
        }),
      },
    }
    const { runtime } = setup({ lab: { 'well-selection': { wellId: 'well-42' } } })
    await act(async () => {
      await Promise.all([runtime.prepare(lab), runtime.prepare(units)])
    })
    const user = userEvent.setup()
    render(<UserContextTab />)
    await user.type(screen.getByLabelText('Search user-context owners'), 'lab:well-selection')
    expect(screen.getByRole('button', { name: 'Inspect lab' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Inspect units' })).toBeNull()
    await user.click(screen.getByRole('tab', { name: 'Keys' }))
    await user.click(screen.getByRole('button', { name: 'lab:well-selection' }))
    expect(JSON.parse(screen.getByLabelText('value of lab:well-selection').textContent)).toEqual({
      wellId: 'well-42',
    })
  })
  it('shows a record the owner schema rejects as invalid, with the reason', async () => {
    const { runtime } = setup({ units: { system: 'nautical' } })
    await expect(runtime.prepare(units)).rejects.toMatchObject({
      code: 'user-context/invalid-value',
    })
    render(<UserContextTab />)
    expect(screen.getAllByText('Invalid')).toHaveLength(2)
    expect(screen.getByRole('alert').textContent).toContain('system')
  })
  it('keeps the stored value when a write fails and reads the owner again', async () => {
    const { runtime, hydrate } = setup({}, async () => {
      throw new Error('Storage is unavailable')
    })
    await runtime.prepare(units)
    render(<UserContextTab />)
    await act(async () => {
      const result = await runtime.bind(units).set('system', 'imperial')
      expect(result.ok).toBe(false)
    })
    await waitFor(() => expect(hydrate).toHaveBeenCalledTimes(2))
    expect(screen.getAllByText('Ready')).toHaveLength(2)
    expect(screen.getByText('No stored value')).toBeTruthy()
  })
  it('shows a write only once the server accepts it, and clears every value on a reset', async () => {
    let accept!: (record: StateRecord) => void
    const { runtime } = setup(
      { units: { system: 'metric' } },
      () =>
        new Promise(resolve => {
          accept = resolve
        }),
    )
    await runtime.prepare(units)
    const view = render(<UserContextTab />)
    let write!: Promise<UserContextResult<unknown>>
    act(() => {
      write = runtime.bind(units).set('system', 'imperial')
    })
    await waitFor(() => expect(accept).toBeTypeOf('function'))
    expect(screen.getByLabelText('value of units').textContent).toContain('"metric"')
    await act(async () => {
      accept({ id: 'units', revision: 2, value: { system: 'imperial' } })
      await write
    })
    expect(screen.getByLabelText('value of units').textContent).toContain('"imperial"')
    expect(screen.getByText('Record revision 2')).toBeTruthy()
    act(() => runtime.reset())
    expect(screen.getByText('No user-context owners loaded')).toBeTruthy()
    expect(view.container.textContent).not.toContain('imperial')
    view.unmount()
  })
  it('makes the entire row clickable and supports arrow, Home and End navigation across 30 owners', async () => {
    setup()
    await owners(30)
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
    setup()
    await owners(30)
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
