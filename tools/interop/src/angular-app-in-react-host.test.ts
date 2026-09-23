/**
 * A real Angular App placed by a React host's `AppHost` at a URL boundary. The Angular router has
 * to read and write the page through the runtime's neutral navigator only, follow the host's
 * navigations, publish its breadcrumbs to the host's store, and have its `canDeactivate` guards
 * asked before the host leaves it.
 */

import { ChangeDetectionStrategy, Component, inject } from '@angular/core'
import { toSignal } from '@angular/core/rxjs-interop'
import { ActivatedRoute, RouterLink, type CanDeactivateFn } from '@angular/router'
import { createApp, injectMfeMount, mfeRouteData } from '@company/mfe-angular'
import {
  createNavigationIntent,
  KIND_ATTRIBUTE,
  parseBoundaryLocation,
  SCOPE_ATTRIBUTE,
  type NavigationOutcome,
} from '@company/mfe-runtime'
import { AppHost } from '@company/mfe-react'
import { renderSuspending } from '@company/mfe-react/testing'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { createElement as h, useState, type ReactNode } from 'react'
import { map } from 'rxjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  applicationCensus,
  createPageRuntime,
  overlayRootCount,
  reactHostPage,
} from './__tests__/harness.ts'

const applications = applicationCensus()

@Component({
  selector: 'interop-item',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<h1>Item {{ itemId() }}</h1>
    <p>depth {{ depth }}</p>
    <a routerLink="/items/7">Open item 7</a>`,
})
class ItemComponent {
  readonly itemId = toSignal(
    inject(ActivatedRoute).paramMap.pipe(map(params => params.get('itemId'))),
  )
  readonly depth = injectMfeMount().depth
}

@Component({
  selector: 'interop-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<h1>Editing</h1>',
})
class EditorComponent {}

/** The guard's questions and the pending answer, reset before every test. */
const guard: {
  asked: { readonly component: unknown; readonly nextUrl: string }[]
  answer: ((allowed: boolean) => void) | null
} = { asked: [], answer: null }

beforeEach(() => {
  guard.asked = []
  guard.answer = null
})

const confirmLeave: CanDeactivateFn<EditorComponent> = (component, _route, _current, next) => {
  guard.asked.push({ component, nextUrl: next.url })
  return new Promise<boolean>(resolve => {
    guard.answer = resolve
  })
}

const insightsApp = createApp({
  id: 'insights',
  version: '3.1.0',
  routes: [
    {
      path: 'items',
      data: mfeRouteData({ breadcrumb: 'Items' }),
      children: [{ path: ':itemId', component: ItemComponent }],
    },
    { path: 'edit', component: EditorComponent, canDeactivate: [confirmLeave] },
  ],
  providers: [applications.providers],
})

function placedAtInsights(): ReactNode {
  return h(AppHost, { appId: 'insights', basePath: '/insights' })
}

describe('an Angular App placed by a React AppHost', () => {
  it('renders the route the current location names below its base path', async () => {
    const memory = createPageRuntime({
      definitions: [insightsApp],
      initialEntries: ['/insights/items/42'],
    })

    await renderSuspending(reactHostPage(memory.runtime, placedAtInsights()))

    const heading = await screen.findByRole('heading', { name: 'Item 42' })
    const scope = heading.closest(`[${SCOPE_ATTRIBUTE}]`)
    expect(scope?.getAttribute(SCOPE_ATTRIBUTE)).toBe('insights')
    expect(scope?.getAttribute(KIND_ATTRIBUTE)).toBe('app')
    expect(screen.getByText('depth 1')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open item 7' })).toHaveAttribute(
      'href',
      '/insights/items/7',
    )
  })

  it('navigates from inside through the neutral navigator, never the browser’s history', async () => {
    const memory = createPageRuntime({
      definitions: [insightsApp],
      initialEntries: ['/insights/items/42'],
    })
    const navigatorPush = vi.spyOn(memory.runtime.navigator, 'push')
    const historyPush = vi.spyOn(window.history, 'pushState')
    const pageUrl = window.location.href
    await renderSuspending(reactHostPage(memory.runtime, placedAtInsights()))

    fireEvent.click(await screen.findByRole('link', { name: 'Open item 7' }))

    await screen.findByRole('heading', { name: 'Item 7' })
    expect(navigatorPush).toHaveBeenCalledTimes(1)
    expect(navigatorPush.mock.calls[0]?.[0]).toBe('/insights/items/7')
    expect(memory.navigation.entries).toEqual(['/insights/items/42', '/insights/items/7'])
    expect(historyPush).not.toHaveBeenCalled()
    expect(window.location.href).toBe(pageUrl)
    historyPush.mockRestore()
  })

  it('follows the host’s navigations: entries the host pushed, then back and forward', async () => {
    const memory = createPageRuntime({
      definitions: [insightsApp],
      initialEntries: ['/insights/items/42'],
    })
    await renderSuspending(reactHostPage(memory.runtime, placedAtInsights()))
    await screen.findByRole('heading', { name: 'Item 42' })

    memory.navigation.push('/insights/items/9')
    memory.navigation.push('/insights/items/10')
    memory.navigation.back()

    await screen.findByRole('heading', { name: 'Item 9' })

    memory.navigation.forward()

    await screen.findByRole('heading', { name: 'Item 10' })
    // The router followed the page; it did not write a history entry of its own.
    expect(memory.navigation.entries).toEqual([
      '/insights/items/42',
      '/insights/items/9',
      '/insights/items/10',
    ])
  })

  it('publishes its breadcrumbs to the runtime’s store as it navigates', async () => {
    const memory = createPageRuntime({
      definitions: [insightsApp],
      initialEntries: ['/insights/items/42'],
    })
    await renderSuspending(reactHostPage(memory.runtime, placedAtInsights()))
    await screen.findByRole('heading', { name: 'Item 42' })

    expect(memory.runtime.breadcrumbs.getSnapshot()).toEqual([
      { key: '/insights/items', label: 'Items', href: '/insights/items' },
      { key: '/insights/items/42', label: '42', href: '/insights/items/42', current: true },
    ])

    fireEvent.click(screen.getByRole('link', { name: 'Open item 7' }))

    await waitFor(() => {
      expect(memory.runtime.breadcrumbs.getSnapshot().at(-1)).toEqual({
        key: '/insights/items/7',
        label: '7',
        href: '/insights/items/7',
        current: true,
      })
    })
  })

  it('disposes the Angular application and every registration when the host unmounts it', async () => {
    const memory = createPageRuntime({
      definitions: [insightsApp],
      initialEntries: ['/insights/items/42'],
    })
    const { runtime } = memory
    const view = await renderSuspending(reactHostPage(runtime, placedAtInsights()))
    await screen.findByRole('heading', { name: 'Item 42' })
    expect(applications.live).toBe(1)
    expect(runtime.navigator.blockerCount).toBe(1)
    expect(runtime.breadcrumbs.contributionCount).toBe(1)

    view.unmount()

    await waitFor(() => {
      expect(applications.live).toBe(0)
    })
    expect(runtime.navigator.blockerCount).toBe(0)
    expect(runtime.breadcrumbs.contributionCount).toBe(0)
    expect(runtime.breadcrumbs.getSnapshot()).toEqual([])
    expect(overlayRootCount()).toBe(0)
  })
})

describe('an Angular App’s canDeactivate guard and a React host leaving it', () => {
  /**
   * What a React shell does to leave an App: ask the runtime's navigator, and commit — write the
   * page's location and stop rendering the App — only once every mount has agreed.
   */
  function shellPage(memory: ReturnType<typeof createPageRuntime>, outcomes: NavigationOutcome[]) {
    function Shell(): ReactNode {
      const [left, setLeft] = useState(false)
      const { navigator } = memory.runtime

      const leave = (): void => {
        const intent = createNavigationIntent(
          navigator.read(),
          parseBoundaryLocation('/elsewhere'),
          '/insights',
        )
        void navigator
          .requestNavigation(intent, () => {
            navigator.push('/elsewhere')
            setLeft(true)
          })
          .then(outcome => {
            outcomes.push(outcome)
          })
      }

      return h(
        'main',
        null,
        h('button', { type: 'button', onClick: leave }, 'Leave'),
        left ? h('p', null, 'Elsewhere') : placedAtInsights(),
      )
    }
    return reactHostPage(memory.runtime, h(Shell))
  }

  it('holds the navigation until the guard answers, then lets the host leave', async () => {
    const memory = createPageRuntime({
      definitions: [insightsApp],
      initialEntries: ['/insights/edit'],
    })
    const outcomes: NavigationOutcome[] = []
    await renderSuspending(shellPage(memory, outcomes))
    await screen.findByRole('heading', { name: 'Editing' })

    fireEvent.click(screen.getByRole('button', { name: 'Leave' }))

    await waitFor(() => {
      expect(guard.asked).toHaveLength(1)
    })
    expect(guard.asked[0]?.component).toBeInstanceOf(EditorComponent)
    expect(guard.asked[0]?.nextUrl).toBe('/elsewhere')
    // Held: the page has not moved and the App is still there.
    expect(outcomes).toEqual([])
    expect(memory.navigation.entries).toEqual(['/insights/edit'])
    expect(screen.getByRole('heading', { name: 'Editing' })).toBeInTheDocument()

    guard.answer?.(true)

    await screen.findByText('Elsewhere')
    expect(outcomes).toEqual(['proceeded'])
    expect(memory.navigation.entries).toEqual(['/insights/edit', '/elsewhere'])
    await waitFor(() => {
      expect(applications.live).toBe(0)
    })
  })

  it('keeps the host on the App when the guard refuses', async () => {
    const memory = createPageRuntime({
      definitions: [insightsApp],
      initialEntries: ['/insights/edit'],
    })
    const outcomes: NavigationOutcome[] = []
    await renderSuspending(shellPage(memory, outcomes))
    await screen.findByRole('heading', { name: 'Editing' })

    fireEvent.click(screen.getByRole('button', { name: 'Leave' }))
    await waitFor(() => {
      expect(guard.asked).toHaveLength(1)
    })
    guard.answer?.(false)

    await waitFor(() => {
      expect(outcomes).toEqual(['blocked'])
    })
    expect(memory.navigation.entries).toEqual(['/insights/edit'])
    expect(screen.getByRole('heading', { name: 'Editing' })).toBeInTheDocument()
    expect(applications.live).toBe(1)
  })
})
