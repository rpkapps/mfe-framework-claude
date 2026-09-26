/**
 * Each App placed by each framework's App host: a React App on TanStack Router and an Angular App
 * on its own router, each by React's `AppHost` and by Angular's `<mfe-app-host>`. Whichever
 * framework built the App and whichever placed it, the App routes below the boundary its host
 * assigned, reads and writes the page through the runtime's navigator only, follows the host's
 * navigations, and leaves nothing behind once its host removes it.
 *
 * A host that navigates with its own router moves the page's URL without the runtime's bridge
 * hearing it: the browser bridge hears only `popstate`, and a router writes history itself. So a
 * shell calls `navigator.announce()` after each navigation of its router, and a mounted App has to
 * follow that announcement. The memory bridge behaves like the browser here: a push through the
 * bridge itself, as the shell's router makes one, notifies nobody.
 */

import type { MemoryRuntime } from '@company/mfe-react/testing'
import { fireEvent, waitFor, within } from '@testing-library/react'
import { describe, expect, it, onTestFinished, vi } from 'vitest'

import {
  appHosts,
  createPageRuntime,
  expectedScope,
  expectReleased,
  overlayRootCount,
  scopeOf,
  scopeRootCount,
  type AppPlacement,
  type PlacedApp,
} from './__tests__/harness.ts'
import { insightsApp, ledgerApp, liveApps } from './fixtures/apps.ts'

/** Each App, with what it shows at an entry and what of it is alive. */
const apps = [
  {
    name: 'a React App',
    id: 'ledger',
    heading: (entry: number) => `Ledger entry ${String(entry)}`,
    shows: ['under /ledger'],
    live: () => liveApps.ledger,
  },
  {
    name: 'an Angular App',
    id: 'insights',
    heading: (entry: number) => `Insights entry ${String(entry)}`,
    shows: ['under /insights', 'depth 1'],
    live: () => liveApps.insights,
  },
] as const

describe.each(apps)('$name', app => {
  const entry = (n: number): string => `/${app.id}/entries/${String(n)}`

  /** A page at entry 7, which the scenario may watch before anything is placed on it. */
  function createPage(): MemoryRuntime {
    return createPageRuntime({ definitions: [ledgerApp, insightsApp], initialEntries: [entry(7)] })
  }

  /** What the navigator tells its subscribers, beside the Apps that subscribed through it. */
  function hear(memory: MemoryRuntime): ReturnType<typeof vi.fn> {
    const heard = vi.fn()
    onTestFinished(memory.runtime.navigator.subscribe(heard))
    return heard
  }

  async function place(memory: MemoryRuntime, host: AppPlacement): Promise<PlacedApp> {
    const placed = await host(memory.runtime, app.id, `/${app.id}`)
    await within(placed.container).findByRole('heading', { name: app.heading(7) })
    return placed
  }

  describe.each(appHosts)('placed by %s', (_host, host) => {
    it('renders the route below the base path its host assigned, in one scope root', async () => {
      const { container, failures } = await place(createPage(), host)

      const heading = within(container).getByRole('heading', { name: app.heading(7) })
      for (const text of app.shows) expect(within(container).getByText(text)).toBeInTheDocument()
      expect(scopeRootCount(container)).toBe(1)
      expect(scopeOf(heading)).toEqual(expectedScope(app.id, 'app'))
      expect(within(container).getByRole('link', { name: 'Open entry 8' })).toHaveAttribute(
        'href',
        entry(8),
      )
      expect(failures).toEqual([])
    })

    it('navigates from inside through the neutral navigator, never the browser’s history', async () => {
      const memory = createPage()
      // The App writes through its own bridge on the navigator, which commits to the page's.
      const navigatorPush = vi.spyOn(memory.navigation, 'push')
      const historyPush = vi.spyOn(window.history, 'pushState')
      onTestFinished(() => {
        historyPush.mockRestore()
      })
      const pageUrl = window.location.href
      const { container } = await place(memory, host)

      fireEvent.click(within(container).getByRole('link', { name: 'Open entry 8' }))

      await within(container).findByRole('heading', { name: app.heading(8) })
      expect(navigatorPush).toHaveBeenCalledTimes(1)
      expect(navigatorPush.mock.calls[0]?.[0]).toBe(entry(8))
      expect(memory.navigation.entries).toEqual([entry(7), entry(8)])
      expect(historyPush).not.toHaveBeenCalled()
      expect(window.location.href).toBe(pageUrl)
    })

    it('follows the host’s navigations: entries the host pushed, then back and forward', async () => {
      const memory = createPage()
      const { container } = await place(memory, host)

      memory.navigation.push(entry(8))
      memory.navigation.push(entry(9))
      memory.navigation.back()

      await within(container).findByRole('heading', { name: app.heading(8) })

      memory.navigation.forward()

      await within(container).findByRole('heading', { name: app.heading(9) })
      // The App followed the page; it wrote no history entry of its own.
      expect(memory.navigation.entries).toEqual([entry(7), entry(8), entry(9)])
    })

    it('stays where it was after a host push nobody announced, and follows the announcement', async () => {
      const memory = createPage()
      const { container } = await place(memory, host)
      const heard = hear(memory)

      memory.navigation.push(entry(8))
      // Long enough for anything the page was told to reach a React root or an Angular view.
      await new Promise(resolve => setTimeout(resolve, 20))

      // The URL moved under the App, and nothing told it.
      expect(memory.runtime.navigator.read().pathname).toBe(entry(8))
      expect(heard).not.toHaveBeenCalled()
      expect(within(container).getByRole('heading', { name: app.heading(7) })).toBeInTheDocument()

      memory.runtime.navigator.announce()

      await within(container).findByRole('heading', { name: app.heading(8) })
    })

    it('follows each announced host push, and hears nothing from an announcement that moved nowhere', async () => {
      const memory = createPage()
      const { container } = await place(memory, host)
      const heard = hear(memory)

      memory.navigation.push(entry(8))
      memory.runtime.navigator.announce()

      await within(container).findByRole('heading', { name: app.heading(8) })
      expect(heard).toHaveBeenCalledExactlyOnceWith({ pathname: entry(8), search: '', hash: '' })

      memory.runtime.navigator.announce()
      memory.navigation.push(entry(9))
      memory.runtime.navigator.announce()

      await within(container).findByRole('heading', { name: app.heading(9) })
      expect(heard).toHaveBeenCalledTimes(2)
      // The App followed the page; it wrote no history entry of its own.
      expect(memory.navigation.entries).toEqual([entry(7), entry(8), entry(9)])
    })

    it('is unmounted with everything it registered once its host removes it', async () => {
      const memory = createPage()
      const { runtime } = memory
      const { container, remove } = await place(memory, host)
      await waitFor(() => {
        expect(runtime.breadcrumbs.contributionCount).toBe(1)
      })
      expect(app.live()).toBe(1)
      expect(runtime.navigator.blockerCount).toBe(1)
      expect(overlayRootCount()).toBe(1)

      remove()

      await waitFor(() => {
        expect(app.live()).toBe(0)
      })
      expect(within(container).queryByRole('heading')).not.toBeInTheDocument()
      expectReleased(runtime)
    })
  })
})
