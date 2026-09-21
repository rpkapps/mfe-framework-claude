/**
 * What a page that never opted in pays, counted as calls rather than read off the DOM, because
 * "renders nothing" is easy to satisfy while still fetching the chunk. Plain assertions rather
 * than jest-dom's, whose type augmentation is kept beside the `expect.extend` in
 * `packages/mfe-react/vitest.setup.ts` so the two cannot drift (decisions.md §11).
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ReactNode } from 'react'

import type * as DevtoolsMount from './devtools-mount.tsx'
import { DEVTOOLS_STORAGE_KEY } from './devtools-settings.ts'

/** A counter, not an implementation: `stubPanel` records the call through it. */
const loadPanel = vi.fn()

vi.mock('./load-panel.ts', () => ({
  loadPanel: (): Promise<{ DevtoolsPanel: () => ReactNode }> => stubPanel(),
  forgetPanel: (): void => {},
}))

/** One promise per case rather than per call, because `use()` suspends again on every promise it has not seen. */
let panelModule: Promise<{ DevtoolsPanel: () => ReactNode }>

function stubPanel(): Promise<{ DevtoolsPanel: () => ReactNode }> {
  loadPanel()
  return panelModule
}

async function mount(): Promise<typeof DevtoolsMount> {
  vi.resetModules()
  return await import('./devtools-mount.tsx')
}

beforeEach(() => {
  panelModule = Promise.resolve({
    DevtoolsPanel: () => <button type="button">Open the developer tools</button>,
  })
  loadPanel.mockReset()
  window.localStorage.clear()
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  window.localStorage.clear()
})

describe('the devtools mount', () => {
  it('renders nothing and fetches nothing when the flag is off', async () => {
    const { MfeDevtools } = await mount()

    const { container } = render(<MfeDevtools />)

    expect(container.innerHTML).toBe('')
    expect(loadPanel).toHaveBeenCalledTimes(0)
  })

  it('fetches nothing for a value it does not understand', async () => {
    window.localStorage.setItem(DEVTOOLS_STORAGE_KEY, 'maybe?')
    const { MfeDevtools } = await mount()

    render(<MfeDevtools />)

    expect(loadPanel).toHaveBeenCalledTimes(0)
  })

  it('fetches the panel once when the flag is on', async () => {
    window.localStorage.setItem(DEVTOOLS_STORAGE_KEY, '1')
    const { MfeDevtools } = await mount()

    // Awaited, because an un-awaited `act` leaves the boundary showing its fallback.
    await act(async () => {
      render(<MfeDevtools />)
      await panelModule
    })

    expect(screen.queryByRole('button', { name: 'Open the developer tools' })).not.toBeNull()
    // Called, not called exactly once: `use` renders again once the promise settles, so a count
    // here would be asserting React's render passes.
    expect(loadPanel).toHaveBeenCalled()
  })

  it('fetches the panel when the query parameter turns it on', async () => {
    window.history.replaceState(null, '', '/?devtools=1')
    const { MfeDevtools } = await mount()

    await act(async () => {
      render(<MfeDevtools />)
      await panelModule
    })

    expect(loadPanel).toHaveBeenCalled()
  })

  it('renders nothing when the browser refuses storage, rather than throwing', async () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    })
    const { MfeDevtools } = await mount()

    const { container } = render(<MfeDevtools />)

    expect(container.innerHTML).toBe('')
    expect(loadPanel).toHaveBeenCalledTimes(0)
    vi.restoreAllMocks()
  })
})

/**
 * The code-splitting boundary is a property of the import graph, not of a render, so it is
 * asserted against the source: a static re-export from the barrel would leave the dynamic import
 * doing nothing, and nothing about that is visible at runtime (§22).
 */
describe('the public barrel', () => {
  const here = dirname(fileURLToPath(import.meta.url))

  /** Every module reachable from `index.ts` by a *static* import. */
  function staticGraph(entry: string, seen = new Set<string>()): ReadonlySet<string> {
    if (seen.has(entry)) return seen
    seen.add(entry)

    const source = readFileSync(entry, 'utf8')
    for (const match of source.matchAll(/(?:^|\n)\s*(?:import|export)[^\n]*?from\s*'(\.[^']+)'/g)) {
      const specifier = match[1]
      if (specifier !== undefined) staticGraph(resolve(dirname(entry), specifier), seen)
    }
    return seen
  }

  it('does not reach the panel, so the chunk stays a chunk', () => {
    const reachable = [...staticGraph(resolve(here, 'index.ts'))]

    const inPanelDirectory = (file: string): boolean =>
      file.includes(`${sep}panel${sep}`) || file.includes('/panel/')

    expect(reachable.filter(inPanelDirectory)).toEqual([])
  })
})
