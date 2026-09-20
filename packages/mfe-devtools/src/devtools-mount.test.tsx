/**
 * What a page that never opted in pays.
 *
 * The assertions that matter here are about work *not* happening, so they count
 * calls rather than inspect the DOM: "renders nothing" is easy to satisfy by
 * accident while still fetching the chunk, and the fetch is the cost.
 *
 * Each case re-imports the modules, because the store is module state on
 * purpose — one shell per document — and a test that shared it with the
 * previous case would be asserting against whatever that one left behind.
 *
 * Plain assertions rather than jest-dom's: the matchers come with a type
 * augmentation that `packages/mfe-react/vitest.setup.ts` keeps beside its own
 * `expect.extend` so the two cannot drift (decisions.md §11), and reaching for
 * them here would mean a second copy of that pairing for two assertions.
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

/**
 * A stand-in for the real panel: the chunk's contents are not what is on trial.
 *
 * The promise is created once per case rather than per call, because `use()`
 * suspends again on every promise it has not seen — a loader that returned a
 * fresh one each render would never resolve. That is the invariant the real
 * `load-panel.ts` exists to hold, so the double has to hold it too.
 */
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

    // Awaited, because the chunk suspends: an un-awaited `act` leaves the
    // boundary showing its fallback for as long as the assertion cares to look.
    await act(async () => {
      render(<MfeDevtools />)
      await panelModule
    })

    expect(screen.queryByRole('button', { name: 'Open the developer tools' })).not.toBeNull()
    // Called, not called exactly once: `use` renders again once the promise
    // settles, so a count here would be asserting React's render passes. That
    // the second call returns the *same* promise is what matters, and it is
    // `load-panel.test.ts` that holds it.
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
 * The code-splitting boundary is a property of the import graph, not of a
 * render, so it is asserted against the source.
 *
 * A static re-export of the panel from the barrel — the natural thing to write
 * — would put every component it imports back into the host's initial chunk and
 * leave the dynamic import doing nothing. Nothing about that failure is visible
 * at runtime: the tool still works, it just stopped being free.
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
