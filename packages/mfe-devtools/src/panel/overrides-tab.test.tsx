/**
 * A row is text until it is pressed and a box after, and the box has a button in it, so "blur ends
 * the edit" cannot be read off the input alone. The registry is doubled because standing a runtime
 * up would be testing the runtime.
 */

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RegistryEntry } from '@company/mfe-react'
import { devtools } from '../devtools-store.ts'
import { OverridesTab } from './overrides-tab.tsx'

const ENTRIES: readonly RegistryEntry[] = [
  {
    id: 'operations',
    definitionKind: 'app',
    adapter: 'react',
    manifestUrl: 'http://cdn.example.com/operations/mf-manifest.json',
  },
  {
    id: 'reports',
    definitionKind: 'app',
    adapter: 'react',
    manifestUrl: 'http://cdn.example.com/reports/mf-manifest.json',
  },
]

vi.mock('./use-devtools.ts', () => ({
  useRegistryEntries: (): readonly RegistryEntry[] => ENTRIES,
  useActiveOverrides: (): ReadonlyMap<string, string> => new Map(),
  useContainerLookup: (): ((id: string) => string | undefined) => () => undefined,
}))

/** The row for `id`, found by the id it prints. */
function row(id: string): HTMLElement {
  const title = screen.getByText(id)
  const element = title.closest('[data-slot="item"]')
  if (!(element instanceof HTMLElement)) throw new Error(`no row for ${id}`)
  return element
}

const urlBox = (id: string): HTMLElement | null =>
  within(row(id)).queryByLabelText(`Manifest URL for ${id}`)

beforeEach(() => {
  devtools.clearDraft()
})

afterEach(() => {
  devtools.clearDraft()
})

describe('editing a row', () => {
  it('shows the URL as text until the row is pressed', async () => {
    const user = userEvent.setup()
    render(<OverridesTab />)

    expect(urlBox('operations')).toBeNull()

    await user.click(within(row('operations')).getByTitle(ENTRIES[0]?.manifestUrl ?? ''))

    expect(urlBox('operations')).not.toBeNull()
  })

  it('opens one row at a time, so the list stays a list', async () => {
    const user = userEvent.setup()
    render(<OverridesTab />)

    await user.click(within(row('operations')).getByTitle(ENTRIES[0]?.manifestUrl ?? ''))
    await user.click(within(row('reports')).getByTitle(ENTRIES[1]?.manifestUrl ?? ''))

    expect(urlBox('operations')).toBeNull()
    expect(urlBox('reports')).not.toBeNull()
  })

  it('stays open while the press lands on the "use" button beside the input', async () => {
    const user = userEvent.setup()
    render(<OverridesTab />)

    await user.type(screen.getByLabelText('Dev server origin'), '3001')
    await user.click(within(row('operations')).getByTitle(ENTRIES[0]?.manifestUrl ?? ''))
    await user.click(within(row('operations')).getByRole('button', { name: 'Use' }))

    expect(urlBox('operations')).toHaveProperty('value', 'http://localhost:3001/mf-manifest.json')
    expect(urlBox('operations')).not.toBeNull()
  })

  it('goes back to text once focus leaves the row', async () => {
    const user = userEvent.setup()
    render(<OverridesTab />)

    await user.click(within(row('operations')).getByTitle(ENTRIES[0]?.manifestUrl ?? ''))
    await user.tab()
    await user.tab()
    await user.tab()

    expect(urlBox('operations')).toBeNull()
  })

  it('keeps the box open on a value the boot reader would refuse', async () => {
    const user = userEvent.setup()
    render(<OverridesTab />)

    await user.click(within(row('operations')).getByTitle(ENTRIES[0]?.manifestUrl ?? ''))
    await user.type(urlBox('operations') as HTMLElement, '/relative')
    await user.tab()
    await user.tab()
    await user.tab()

    expect(urlBox('operations')).not.toBeNull()
    expect(screen.getByText(/absolute URL/)).toBeTruthy()
  })
})
