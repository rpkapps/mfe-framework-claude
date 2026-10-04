import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { UserStorageAdapter, UserStorageState } from '@company/mfe-core'
import { UserStorageStore } from '@company/mfe-runtime'
import { createMemoryUserStorage } from '@company/mfe-runtime/testing'

import { StorageTab } from './storage-tab.tsx'

const context = vi.hoisted(() => ({
  storage: { user: undefined as UserStorageStore | undefined },
}))
vi.mock('@company/mfe-react', () => ({ useMfeRuntime: () => context }))
afterEach(() => {
  context.storage.user?.dispose()
  context.storage.user = undefined
})

const rows: UserStorageState = {
  '@example/maps': { layers: { v: 2, d: ['wells', 'faults'], revision: 7 } },
  '@host': { theme: { v: 1, d: 'dark', revision: 3 } },
}

async function setup(adapter: UserStorageAdapter = createMemoryUserStorage(rows)) {
  const store = new UserStorageStore({ adapter })
  context.storage.user = store
  await store.whenLoaded()
  return store
}

describe('Storage tab', () => {
  it('explains a shell without a user storage adapter', () => {
    render(<StorageTab />)
    expect(screen.getByText('User storage is not configured')).toBeTruthy()
  })

  it('lists rows by owner and key with their revision, schema version and data', async () => {
    await setup()
    const user = userEvent.setup()
    render(<StorageTab />)
    expect(screen.getByText('Loaded')).toBeTruthy()
    expect(screen.getByText('@example/maps')).toBeTruthy()
    expect(screen.getByText('@host')).toBeTruthy()
    // Sorted by owner, so the first row is inspected.
    expect(
      screen
        .getByRole('button', { name: 'Inspect @example/maps › layers' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
    expect(screen.getByText('Owner @example/maps · Revision 7 · Schema version 2')).toBeTruthy()
    expect(
      JSON.parse(screen.getByLabelText('stored data of @example/maps › layers').textContent ?? ''),
    ).toEqual(['wells', 'faults'])
    await user.click(screen.getByRole('button', { name: 'Inspect @host › theme' }))
    expect(screen.getByLabelText('stored data of @host › theme').textContent).toBe('"dark"')
    await user.type(screen.getByLabelText('Search stored keys'), 'missing')
    expect(screen.getByText('No keys match your search')).toBeTruthy()
  })

  it('follows a save from saving to ready, and keeps the snapshot stable in between', async () => {
    let accept!: () => void
    const memory = createMemoryUserStorage(rows)
    const store = await setup({
      ...memory,
      save: (...args) =>
        new Promise((resolve, reject) => {
          accept = () => {
            memory.save(...args).then(resolve, reject)
          }
        }),
    })
    render(<StorageTab />)
    let saving!: Promise<void>
    act(() => {
      saving = store.save('@example/maps', 'layers', { v: 2, d: ['seismic'] })
    })
    expect(screen.getAllByText('Saving')).toHaveLength(2)
    expect(
      JSON.parse(
        screen.getByLabelText('value being saved for @example/maps › layers').textContent ?? '',
      ),
    ).toEqual(['seismic'])
    await act(async () => {
      accept()
      await saving
    })
    expect(screen.queryByText('Saving')).toBeNull()
    expect(screen.getByText('Owner @example/maps · Revision 8 · Schema version 2')).toBeTruthy()
  })

  it('shows a failed save with its message', async () => {
    const memory = createMemoryUserStorage(rows)
    const store = await setup({
      ...memory,
      save: () => Promise.reject(new Error('quota exceeded')),
    })
    render(<StorageTab />)
    await act(async () => {
      await store.save('@example/maps', 'layers', { v: 2, d: [] }).catch(() => {})
    })
    expect(screen.getAllByText('Error')).toHaveLength(2)
    expect(screen.getByText('Save failed')).toBeTruthy()
    expect(screen.getByText(/quota exceeded/)).toBeTruthy()
  })

  it('shows a failed load and loads again from Retry', async () => {
    const memory = createMemoryUserStorage(rows)
    const load = vi
      .fn<UserStorageAdapter['load']>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(memory.load)
    await setup({ ...memory, load })
    const user = userEvent.setup()
    render(<StorageTab />)
    expect(screen.getByText('Load failed')).toBeTruthy()
    expect(screen.getByText(/offline/)).toBeTruthy()
    expect(screen.getByText('No stored values')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.getByText('Loaded')).toBeTruthy())
    expect(load).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: 'Inspect @host › theme' })).toBeTruthy()
  })

  it('unsubscribes when the inspector unmounts', async () => {
    const store = await setup()
    const unsubscribe = vi.fn()
    const subscribeAll = store.subscribeAll.bind(store)
    vi.spyOn(store, 'subscribeAll').mockImplementation(listener => {
      const stop = subscribeAll(listener)
      return () => {
        stop()
        unsubscribe()
      }
    })
    render(<StorageTab />).unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('picks a key from the narrow-dock picker', async () => {
    await setup()
    const user = userEvent.setup()
    render(<StorageTab />)
    await user.click(screen.getByRole('combobox', { name: 'Choose stored key' }))
    await user.type(await screen.findByLabelText('Find a stored key'), 'theme')
    await user.click(await screen.findByRole('option', { name: '@host › theme' }))
    expect(screen.getByText('theme', { selector: 'h2' })).toBeTruthy()
  })
})
