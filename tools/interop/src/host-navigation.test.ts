/**
 * A host that navigates with its own router moves the page's URL without the runtime's bridge
 * hearing it: the browser bridge hears only `popstate`, and a router writes history itself. So a
 * shell calls `navigator.announce()` after each navigation of its router, and a mounted App has to
 * follow that announcement whichever framework built it and whichever framework's host placed it.
 *
 * The memory bridge behaves like the browser here: a push through the bridge itself, as the
 * shell's router makes one, notifies nobody.
 */

import { ChangeDetectionStrategy, Component, inject } from '@angular/core'
import { toSignal } from '@angular/core/rxjs-interop'
import { ActivatedRoute } from '@angular/router'
import { createApp as createAngularApp, MfeAppHostComponent } from '@company/mfe-angular'
import { AppHost, createApp as createReactApp, type MfeRouterContext } from '@company/mfe-react'
import type { MfeRuntime } from '@company/mfe-react/host'
import { renderSuspending, type MemoryRuntime } from '@company/mfe-react/testing'
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router'
import { within } from '@testing-library/react'
import { createElement as h, type ReactNode } from 'react'
import { map } from 'rxjs'
import { describe, expect, it, onTestFinished, vi } from 'vitest'

import {
  createAngularHost,
  createPageRuntime,
  reactHostPage,
  renderInAngularHost,
} from './__tests__/harness.ts'

const reactRoot = createRootRouteWithContext<MfeRouterContext>()({
  component: () => h(Outlet),
})

const reactEntry = createRoute({
  getParentRoute: () => reactRoot,
  path: '/entries/$entryId',
  component: function Entry(): ReactNode {
    // This tree is not the registered one, so the typed accessor resolves to `any`.
    const { entryId } = reactEntry.useParams() as unknown as { entryId: string }
    return h('h1', null, `Ledger entry ${entryId}`)
  },
})

const ledgerApp = createReactApp({
  id: 'ledger',
  version: '1.2.0',
  router: ({ basePath, history, context }) =>
    createRouter({
      routeTree: reactRoot.addChildren([reactEntry]),
      basepath: basePath,
      history,
      context: { ...context },
    }),
})

@Component({
  selector: 'interop-insights-entry',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<h1>Insights entry {{ entryId() }}</h1>',
})
class InsightsEntryComponent {
  readonly entryId = toSignal(
    inject(ActivatedRoute).paramMap.pipe(map(params => params.get('entryId'))),
  )
}

const insightsApp = createAngularApp({
  id: 'insights',
  version: '3.1.0',
  routes: [{ path: 'entries/:entryId', component: InsightsEntryComponent }],
})

/** Each App, with the heading it shows for an entry. */
const apps = [
  {
    name: 'a React App',
    id: 'ledger',
    heading: (entry: number) => `Ledger entry ${String(entry)}`,
  },
  {
    name: 'an Angular App',
    id: 'insights',
    heading: (entry: number) => `Insights entry ${String(entry)}`,
  },
] as const

@Component({
  selector: 'interop-navigating-shell',
  imports: [MfeAppHostComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<mfe-app-host [appId]="appId" [basePath]="basePath" />',
})
class AngularShellComponent {
  appId = ''
  basePath = ''
}

/** Each framework's App host; either has to leave the App to follow the announcement. */
const hosts: readonly (readonly [
  string,
  (runtime: MfeRuntime, appId: string) => Promise<HTMLElement>,
])[] = [
  [
    'React’s AppHost',
    async (runtime, appId) => {
      const view = await renderSuspending(
        reactHostPage(runtime, h(AppHost, { appId, basePath: `/${appId}` })),
      )
      return view.container
    },
  ],
  [
    'Angular’s <mfe-app-host>',
    async (runtime, appId) => {
      const appRef = await createAngularHost(runtime)
      const { element } = await renderInAngularHost(appRef, AngularShellComponent, shell => {
        shell.appId = appId
        shell.basePath = `/${appId}`
      })
      return element
    },
  ],
]

/** Long enough for anything the page was told to reach a React root or an Angular view. */
async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 20))
}

describe.each(apps)('$name inside its boundary', app => {
  async function place(
    host: (typeof hosts)[number][1],
  ): Promise<{ memory: MemoryRuntime; element: HTMLElement; heard: ReturnType<typeof vi.fn> }> {
    const memory = createPageRuntime({
      definitions: [ledgerApp, insightsApp],
      initialEntries: [`/${app.id}/entries/7`],
    })
    const element = await host(memory.runtime, app.id)
    await within(element).findByRole('heading', { name: app.heading(7) })

    // What the navigator tells its subscribers, beside the Apps that subscribed through it.
    const heard = vi.fn()
    const stopHearing = memory.runtime.navigator.subscribe(heard)
    onTestFinished(stopHearing)
    return { memory, element, heard }
  }

  describe.each(hosts)('placed by %s', (_host, host) => {
    it('stays where it was after a host push nobody announced, and follows the announcement', async () => {
      const { memory, element, heard } = await place(host)

      memory.navigation.push(`/${app.id}/entries/8`)
      await settle()

      // The URL moved under the App, and nothing told it.
      expect(memory.runtime.navigator.read().pathname).toBe(`/${app.id}/entries/8`)
      expect(heard).not.toHaveBeenCalled()
      expect(within(element).getByRole('heading', { name: app.heading(7) })).toBeInTheDocument()

      memory.runtime.navigator.announce()

      await within(element).findByRole('heading', { name: app.heading(8) })
    })

    it('follows each announced host push, and hears nothing from an announcement that moved nowhere', async () => {
      const { memory, element, heard } = await place(host)

      memory.navigation.push(`/${app.id}/entries/8`)
      memory.runtime.navigator.announce()

      await within(element).findByRole('heading', { name: app.heading(8) })
      expect(heard).toHaveBeenCalledExactlyOnceWith({
        pathname: `/${app.id}/entries/8`,
        search: '',
        hash: '',
      })

      memory.runtime.navigator.announce()
      memory.navigation.push(`/${app.id}/entries/9`)
      memory.runtime.navigator.announce()

      await within(element).findByRole('heading', { name: app.heading(9) })
      expect(heard).toHaveBeenCalledTimes(2)
      // The App followed the page; it wrote no history entry of its own.
      expect(memory.navigation.entries).toEqual([
        `/${app.id}/entries/7`,
        `/${app.id}/entries/8`,
        `/${app.id}/entries/9`,
      ])
    })
  })
})
