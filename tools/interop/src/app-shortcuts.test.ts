/**
 * A React App and an Angular App on one page, each registering a command with the same shortcut
 * through its own adapter. Each renders in its own root, so neither can reach a registry the host
 * provides through framework context; the runtime's command registry is the one both reach, and
 * the host's single listener has to run only the App the page is inside.
 */

import { ChangeDetectionStrategy, Component, provideEnvironmentInitializer } from '@angular/core'
import { createApp as createAngularApp, injectCommand } from '@company/mfe-angular'
import {
  AppHost,
  createApp as createReactApp,
  useCommand,
  type MfeRouterContext,
} from '@company/mfe-react'
import { renderSuspending } from '@company/mfe-react/testing'
import { createRootRouteWithContext, createRouter } from '@tanstack/react-router'
import { screen, waitFor } from '@testing-library/react'
import { createElement as h, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createPageRuntime, expectReleased, reactHostPage } from './__tests__/harness.ts'

/** How many times each App's command ran, reset before every test. */
const ran = { ledger: 0, insights: 0 }

beforeEach(() => {
  ran.ledger = 0
  ran.insights = 0
  // Pinned, so `mod` is Ctrl whatever machine the suite runs on.
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32')
})

afterEach(() => {
  vi.restoreAllMocks()
})

const ledgerRoot = createRootRouteWithContext<MfeRouterContext>()({
  component: function Ledger(): ReactNode {
    useCommand({
      name: 'export',
      label: 'Export the ledger',
      shortcut: 'mod+e',
      execute: () => {
        ran.ledger += 1
      },
    })
    return h('h1', null, 'Ledger')
  },
})

const ledgerApp = createReactApp({
  id: 'ledger',
  router: ({ basePath, history, context }) =>
    createRouter({ routeTree: ledgerRoot, basepath: basePath, history, context: { ...context } }),
})

@Component({
  selector: 'interop-insights',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<h1>Insights</h1>',
})
class InsightsComponent {}

/** Registered for the App's whole life, as an App-wide command is, whatever route is showing. */
const insightsApp = createAngularApp({
  id: 'insights',
  routes: [{ path: '**', component: InsightsComponent }],
  providers: [
    provideEnvironmentInitializer(() => {
      injectCommand({
        name: 'export',
        label: 'Export the insights',
        shortcut: 'mod+e',
        execute: () => {
          ran.insights += 1
        },
      })
    }),
  ],
})

function press(target: EventTarget = document.body): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: 'e',
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  })
  target.dispatchEvent(event)
  return event
}

describe('shortcuts registered by a React App and an Angular App', () => {
  it('runs only the App the page is inside, through the one listener the host installs', async () => {
    const memory = createPageRuntime({
      definitions: [ledgerApp, insightsApp],
      initialEntries: ['/ledger'],
    })
    const { commands } = memory.runtime
    const listener = (event: KeyboardEvent): void => {
      commands.handleKeyDown(event)
    }
    document.addEventListener('keydown', listener)
    const view = await renderSuspending(
      reactHostPage(
        memory.runtime,
        h(
          'div',
          null,
          h(AppHost, { appId: 'ledger', basePath: '/ledger' }),
          h(AppHost, { appId: 'insights', basePath: '/insights' }),
        ),
      ),
    )
    await screen.findByRole('heading', { name: 'Ledger' })
    await waitFor(() => {
      expect(commands.getSnapshot().map(entry => [entry.id, entry.shortcut])).toEqual(
        expect.arrayContaining([
          ['ledger:export', 'mod+e'],
          ['insights:export', 'mod+e'],
        ]),
      )
    })

    const inLedger = press()
    memory.navigation.push('/insights')
    const inInsights = press()
    memory.navigation.push('/')
    const outside = press()

    expect(ran).toEqual({ ledger: 1, insights: 1 })
    expect(inLedger.defaultPrevented).toBe(true)
    expect(inInsights.defaultPrevented).toBe(true)
    expect(outside.defaultPrevented).toBe(false)
    // Neither App can be live beside the other, so sharing the keys is not a collision.
    expect(memory.diagnostics.filter(record => record.severity === 'warning')).toEqual([])

    view.unmount()
    await waitFor(() => {
      expect(commands.size).toBe(0)
    })
    expectReleased(memory.runtime)
    memory.navigation.push('/ledger')
    press()
    expect(ran).toEqual({ ledger: 1, insights: 1 })
    document.removeEventListener('keydown', listener)
  })
})
