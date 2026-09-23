/**
 * What only an Angular App placed by a React host's `AppHost` does beyond the placement every App
 * shares (`app-placement.test.ts`): publish the breadcrumbs its route data names to the host's
 * store, and have its `canDeactivate` guards asked before the host leaves it.
 */

import { ChangeDetectionStrategy, Component } from '@angular/core'
import type { CanDeactivateFn } from '@angular/router'
import { createApp } from '@company/mfe-angular'
import { AppHost } from '@company/mfe-react'
import {
  createNavigationIntent,
  parseBoundaryLocation,
  type NavigationOutcome,
} from '@company/mfe-react/host'
import { renderSuspending } from '@company/mfe-react/testing'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { createElement as h, useState, type ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  applicationCensus,
  createPageRuntime,
  expectReleased,
  reactHostPage,
} from './__tests__/harness.ts'
import { insightsApp } from './fixtures/apps.ts'

describe('an Angular App placed by a React AppHost', () => {
  it('publishes its breadcrumbs to the runtime’s store as it navigates', async () => {
    const memory = createPageRuntime({
      definitions: [insightsApp],
      initialEntries: ['/insights/entries/7'],
    })
    await renderSuspending(
      reactHostPage(memory.runtime, h(AppHost, { appId: 'insights', basePath: '/insights' })),
    )
    await screen.findByRole('heading', { name: 'Insights entry 7' })

    expect(memory.runtime.breadcrumbs.getSnapshot()).toEqual([
      { key: '/insights/entries', label: 'Entries', href: '/insights/entries' },
      { key: '/insights/entries/7', label: '7', href: '/insights/entries/7', current: true },
    ])

    fireEvent.click(screen.getByRole('link', { name: 'Open entry 8' }))

    await waitFor(() => {
      expect(memory.runtime.breadcrumbs.getSnapshot().at(-1)).toEqual({
        key: '/insights/entries/8',
        label: '8',
        href: '/insights/entries/8',
        current: true,
      })
    })
  })
})

const applications = applicationCensus()

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

const draftsApp = createApp({
  id: 'drafts',
  version: '1.0.0',
  routes: [{ path: 'edit', component: EditorComponent, canDeactivate: [confirmLeave] }],
  providers: [applications.providers],
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
          '/drafts',
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
        left ? h('p', null, 'Elsewhere') : h(AppHost, { appId: 'drafts', basePath: '/drafts' }),
      )
    }
    return reactHostPage(memory.runtime, h(Shell))
  }

  it('holds the navigation until the guard answers, then lets the host leave', async () => {
    const memory = createPageRuntime({ definitions: [draftsApp], initialEntries: ['/drafts/edit'] })
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
    expect(memory.navigation.entries).toEqual(['/drafts/edit'])
    expect(screen.getByRole('heading', { name: 'Editing' })).toBeInTheDocument()

    guard.answer?.(true)

    await screen.findByText('Elsewhere')
    expect(outcomes).toEqual(['proceeded'])
    expect(memory.navigation.entries).toEqual(['/drafts/edit', '/elsewhere'])
    await waitFor(() => {
      expect(applications.live).toBe(0)
    })
    expectReleased(memory.runtime)
  })

  it('keeps the host on the App when the guard refuses', async () => {
    const memory = createPageRuntime({ definitions: [draftsApp], initialEntries: ['/drafts/edit'] })
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
    expect(memory.navigation.entries).toEqual(['/drafts/edit'])
    expect(screen.getByRole('heading', { name: 'Editing' })).toBeInTheDocument()
    expect(applications.live).toBe(1)
  })
})
