/**
 * A real React App — a TanStack router over the framework's boundary history — placed by an
 * Angular host's `<mfe-app-host>`. The router has to route below the boundary the Angular host
 * assigned, read and write the page through the runtime's navigator only, and follow the host's
 * navigations until the Angular host removes it.
 */

import { ChangeDetectionStrategy, Component, signal } from '@angular/core'
import { MfeAppHostComponent, type MfeError } from '@company/mfe-angular'
import { KIND_ATTRIBUTE, SCOPE_ATTRIBUTE } from '@company/mfe-angular/host'
import { createApp, useBasePath, type MfeRouterContext } from '@company/mfe-react'
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Link,
  Outlet,
} from '@tanstack/react-router'
import { fireEvent, waitFor, within } from '@testing-library/react'
import { createElement as h, useEffect, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createAngularHost,
  createPageRuntime,
  overlayRootCount,
  renderInAngularHost,
} from './__tests__/harness.ts'

/** How many of the React App's pages are mounted right now, reset before every test. */
const seen = { live: 0 }

beforeEach(() => {
  seen.live = 0
})

function useCountedWhileMounted(): void {
  useEffect(() => {
    seen.live += 1
    return () => {
      seen.live -= 1
    }
  }, [])
}

const rootRoute = createRootRouteWithContext<MfeRouterContext>()({
  component: () => h(Outlet),
})

const entryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/entries/$entryId',
  component: function Entry(): ReactNode {
    useCountedWhileMounted()
    // This tree is not the registered one, so the typed accessor resolves to `any`.
    const { entryId } = entryRoute.useParams() as unknown as { entryId: string }
    return h(
      'section',
      null,
      h('h1', null, `Entry ${entryId}`),
      h('p', null, `under ${useBasePath()}`),
      h(Link, { to: '/entries/8' }, 'Open entry 8'),
    )
  },
})

const ledgerApp = createApp({
  id: 'ledger',
  version: '1.2.0',
  router: ({ basePath, history, context }) =>
    createRouter({
      routeTree: rootRoute.addChildren([entryRoute]),
      basepath: basePath,
      history,
      context: { ...context },
    }),
})

@Component({
  selector: 'interop-shell',
  imports: [MfeAppHostComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (shown()) {
    <mfe-app-host appId="ledger" basePath="/ledger" (failed)="failures.push($event)" />
  }`,
})
class ShellComponent {
  readonly shown = signal(true)
  readonly failures: MfeError[] = []
}

async function renderShell(initialEntries: readonly string[]) {
  const memory = createPageRuntime({ definitions: [ledgerApp], initialEntries })
  const appRef = await createAngularHost(memory.runtime)
  const view = await renderInAngularHost(appRef, ShellComponent)
  return { memory, ...view }
}

describe('a React App placed by an Angular <mfe-app-host>', () => {
  it('renders the TanStack route below the base path the Angular host assigned', async () => {
    const { element, ref } = await renderShell(['/ledger/entries/7'])

    const heading = await within(element).findByRole('heading', { name: 'Entry 7' })

    expect(within(element).getByText('under /ledger')).toBeInTheDocument()
    const scope = heading.closest(`[${SCOPE_ATTRIBUTE}]`)
    expect(scope?.getAttribute(SCOPE_ATTRIBUTE)).toBe('ledger')
    expect(scope?.getAttribute(KIND_ATTRIBUTE)).toBe('app')
    expect(within(element).getByRole('link', { name: 'Open entry 8' })).toHaveAttribute(
      'href',
      '/ledger/entries/8',
    )
    expect(ref.instance.failures).toEqual([])
  })

  it('follows the host’s navigations: entries the host pushed, then back and forward', async () => {
    const { element, memory } = await renderShell(['/ledger/entries/7'])
    await within(element).findByRole('heading', { name: 'Entry 7' })

    memory.navigation.push('/ledger/entries/8')
    memory.navigation.push('/ledger/entries/9')
    memory.navigation.back()

    await within(element).findByRole('heading', { name: 'Entry 8' })

    memory.navigation.forward()

    await within(element).findByRole('heading', { name: 'Entry 9' })
    expect(memory.navigation.entries).toEqual([
      '/ledger/entries/7',
      '/ledger/entries/8',
      '/ledger/entries/9',
    ])
  })

  it('navigates from inside through the neutral navigator, never the browser’s history', async () => {
    const { element, memory } = await renderShell(['/ledger/entries/7'])
    const historyPush = vi.spyOn(window.history, 'pushState')
    const pageUrl = window.location.href

    fireEvent.click(await within(element).findByRole('link', { name: 'Open entry 8' }))

    await within(element).findByRole('heading', { name: 'Entry 8' })
    expect(memory.navigation.entries).toEqual(['/ledger/entries/7', '/ledger/entries/8'])
    expect(historyPush).not.toHaveBeenCalled()
    expect(window.location.href).toBe(pageUrl)
    historyPush.mockRestore()
  })

  it('is unmounted with everything it registered when the Angular host removes it', async () => {
    const { element, ref, memory } = await renderShell(['/ledger/entries/7'])
    const { runtime } = memory
    await within(element).findByRole('heading', { name: 'Entry 7' })
    await waitFor(() => {
      expect(runtime.breadcrumbs.contributionCount).toBe(1)
    })
    expect(seen.live).toBe(1)
    expect(overlayRootCount()).toBe(1)

    ref.instance.shown.set(false)

    await waitFor(() => {
      expect(seen.live).toBe(0)
    })
    expect(within(element).queryByRole('heading')).not.toBeInTheDocument()
    expect(element.querySelector(`[${SCOPE_ATTRIBUTE}]`)).toBeNull()
    expect(runtime.breadcrumbs.contributionCount).toBe(0)
    expect(runtime.navigator.blockerCount).toBe(0)
    expect(overlayRootCount()).toBe(0)
  })
})
