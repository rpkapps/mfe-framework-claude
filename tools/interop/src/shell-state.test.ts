/**
 * One shell state, read by both frameworks on one page: a React Widget through the React hooks and
 * an Angular Widget through the Angular injectables, both subscribed to the same runtime store. A
 * change has to reach every consumer of the field that changed, and only those.
 */

import { ChangeDetectionStrategy, Component, computed } from '@angular/core'
import { createWidget as createAngularWidget, injectTheme, injectUser } from '@company/mfe-angular'
import { createWidget, DynamicWidget, useTheme } from '@company/mfe-react'
import { renderSuspending } from '@company/mfe-react/testing'
import { act, screen } from '@testing-library/react'
import { createElement as h, Fragment, useEffect, type ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { createPageRuntime, reactHostPage, watchMounts } from './__tests__/harness.ts'

/**
 * How often each consumer did work, reset before every test. The React side counts commits rather
 * than renders, because a React root renders twice under development StrictMode and commits once.
 */
const seen = { reactThemeCommits: 0, angularUserReads: 0 }

beforeEach(() => {
  seen.reactThemeCommits = 0
  seen.angularUserReads = 0
})

const reactThemeBadge = createWidget({
  id: 'theme-badge',
  inputSchema: z.object({}),
  outputSchema: z.object({}),
  render: function ThemeBadge(): ReactNode {
    const theme = useTheme()
    useEffect(() => {
      seen.reactThemeCommits += 1
    })
    return h('p', null, `React sees ${theme}`)
  },
})

@Component({
  selector: 'interop-theme-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<p>Angular sees {{ theme() }}</p>
    <p>Signed in as {{ userName() }}</p>`,
})
class ThemePanelComponent {
  readonly theme = injectTheme()
  readonly #user = injectUser()
  readonly userName = computed(() => {
    seen.angularUserReads += 1
    return this.#user()?.name ?? 'nobody'
  })
}

const angularThemePanel = createAngularWidget({
  id: 'theme-panel',
  inputSchema: z.object({}),
  outputSchema: z.object({}),
  component: ThemePanelComponent,
})

async function renderBothWidgets() {
  const memory = createPageRuntime({
    definitions: [reactThemeBadge, angularThemePanel],
    shellState: { theme: 'light', user: { id: 'u-1', name: 'Ada' } },
  })
  await renderSuspending(
    reactHostPage(
      memory.runtime,
      h(
        Fragment,
        null,
        h(DynamicWidget, { widgetId: 'theme-badge' }),
        h(DynamicWidget, { widgetId: 'theme-panel' }),
      ),
    ),
  )
  await screen.findByText('React sees light')
  await screen.findByText('Angular sees light')
  return memory
}

describe('shell state on a page with a React and an Angular Widget', () => {
  it('reaches the React hook and the Angular injectable alike when the theme changes', async () => {
    const badge = watchMounts(reactThemeBadge)
    const memory = await renderBothWidgets()
    // Every commit of the first render counted, so the one below is the only one added.
    await badge.whenStable()
    const mounted = seen.reactThemeCommits

    act(() => {
      memory.setShellState({ theme: 'dark' })
    })

    expect(screen.getByText('React sees dark')).toBeInTheDocument()
    await screen.findByText('Angular sees dark')
    expect(seen.reactThemeCommits).toBe(mounted + 1)
  })

  it('does not notify an Angular consumer of the user when only the theme changes', async () => {
    const memory = await renderBothWidgets()
    expect(screen.getByText('Signed in as Ada')).toBeInTheDocument()
    expect(seen.angularUserReads).toBe(1)

    act(() => {
      memory.setShellState({ theme: 'dark' })
    })
    await screen.findByText('Angular sees dark')

    expect(seen.angularUserReads).toBe(1)

    // The same consumer does hear a change to the field it reads.
    act(() => {
      memory.setShellState({ user: { id: 'u-2', name: 'Grace' } })
    })

    await screen.findByText('Signed in as Grace')
    expect(seen.angularUserReads).toBe(2)
  })
})
