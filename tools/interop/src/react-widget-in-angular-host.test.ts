/**
 * A real React Widget placed by an Angular host's `<mfe-widget>`. The Angular host renders the
 * scope root and an element; the React definition opens a React root of its own in it, with the
 * same provider-side validation it has in a React host.
 */

import { ChangeDetectionStrategy, Component, signal } from '@angular/core'
import { MfeWidgetComponent, type MfeError, type MfeWidgetEvent } from '@company/mfe-angular'
import {
  KIND_ATTRIBUTE,
  MOUNT_ATTRIBUTE,
  OVERLAY_ROOT_ATTRIBUTE,
  SCOPE_ATTRIBUTE,
} from '@company/mfe-runtime'
import { createWidget } from '@company/mfe-react'
import { fireEvent, waitFor, within } from '@testing-library/react'
import { createElement as h, useEffect, type ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  createAngularHost,
  createPageRuntime,
  overlayRootCount,
  renderInAngularHost,
} from './__tests__/harness.ts'

/**
 * What the React Widget went through, reset before every test. Commits rather than renders,
 * because a React root renders twice under development StrictMode and commits once.
 */
const seen = { commits: 0, live: 0 }

beforeEach(() => {
  seen.commits = 0
  seen.live = 0
})

const counter = createWidget({
  id: 'counter',
  version: '2.0.0',
  inputs: z.object({ label: z.string(), count: z.number() }),
  events: { bumped: z.object({ count: z.number() }) },
  render: function Counter({ inputs, emit }): ReactNode {
    useEffect(() => {
      seen.commits += 1
    })
    useEffect(() => {
      seen.live += 1
      return () => {
        seen.live -= 1
      }
    }, [])

    return h(
      'button',
      {
        type: 'button',
        onClick: () => {
          emit('bumped', { count: inputs.count + 1 })
        },
      },
      `${inputs.label}: ${String(inputs.count)}`,
    )
  },
})

@Component({
  selector: 'interop-host',
  imports: [MfeWidgetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (shown()) {
    <mfe-widget
      widgetId="counter"
      [inputs]="inputs()"
      (event)="events.push($event)"
      (failed)="failures.push($event)"
    />
  }`,
})
class HostComponent {
  readonly shown = signal(true)
  readonly inputs = signal<Readonly<Record<string, unknown>>>({ label: 'Clicks', count: 1 })
  readonly events: MfeWidgetEvent[] = []
  readonly failures: MfeError[] = []
}

async function renderHost(setup?: (host: HostComponent) => void) {
  const memory = createPageRuntime({ definitions: [counter] })
  const appRef = await createAngularHost(memory.runtime)
  const view = await renderInAngularHost(appRef, HostComponent, setup)
  return { memory, appRef, ...view }
}

/** The scope roots between `node` and `container`, innermost first. */
function scopeRootsAround(node: Element, container: Element): readonly Element[] {
  const found: Element[] = []
  let scope = node.closest(`[${SCOPE_ATTRIBUTE}]`)
  while (scope !== null && container.contains(scope)) {
    found.push(scope)
    scope = scope.parentElement?.closest(`[${SCOPE_ATTRIBUTE}]`) ?? null
  }
  return found
}

describe('a React Widget placed by an Angular <mfe-widget>', () => {
  it('renders in a scope root of its own inside the Angular host', async () => {
    const { element } = await renderHost()

    const button = await within(element).findByRole('button', { name: 'Clicks: 1' })

    // Every scope root between the button and the host belongs to this one mount, and its
    // overlay root is the only one on the page.
    const scopes = scopeRootsAround(button, element)
    expect(scopes.length).toBeGreaterThan(0)
    for (const scope of scopes) {
      expect(scope.getAttribute(SCOPE_ATTRIBUTE)).toBe('counter')
      expect(scope.getAttribute(KIND_ATTRIBUTE)).toBe('widget')
    }
    const mountTokens = new Set(scopes.map(scope => scope.getAttribute(MOUNT_ATTRIBUTE)))
    expect(mountTokens.size).toBe(1)
    expect(overlayRootCount()).toBe(1)
    expect(
      document.querySelector(`[${OVERLAY_ROOT_ATTRIBUTE}]`)?.getAttribute(MOUNT_ATTRIBUTE),
    ).toBe([...mountTokens][0])
    expect(seen.live).toBe(1)
  })

  it('re-renders with a changed inputs binding, and not for an equal one', async () => {
    const { ref, appRef, element } = await renderHost()
    await within(element).findByRole('button', { name: 'Clicks: 1' })
    const mounted = seen.commits

    ref.instance.inputs.set({ label: 'Clicks', count: 2 })

    await within(element).findByRole('button', { name: 'Clicks: 2' })
    expect(seen.commits).toBe(mounted + 1)

    // A new object with the same values: Angular binds it, and the Widget has nothing to render.
    ref.instance.inputs.set({ label: 'Clicks', count: 2 })
    await appRef.whenStable()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(seen.commits).toBe(mounted + 1)
    expect(seen.live).toBe(1)
  })

  it('delivers what the React Widget emits to the (event) output as { name, payload }', async () => {
    const { ref, element } = await renderHost()

    fireEvent.click(await within(element).findByRole('button', { name: 'Clicks: 1' }))

    expect(ref.instance.events).toEqual([{ name: 'bumped', payload: { count: 2 } }])
  })

  it('reports first inputs the React Widget refuses through the (failed) output', async () => {
    const { ref, element } = await renderHost(host => {
      host.inputs.set({ label: 'Clicks', count: 'one' })
    })

    await waitFor(() => {
      expect(ref.instance.failures).toHaveLength(1)
    })
    expect(ref.instance.failures[0]).toMatchObject({
      code: 'contract/input-mismatch',
      id: 'counter',
    })
    expect(element.querySelector(`[${SCOPE_ATTRIBUTE}]`)).toBeNull()
    expect(overlayRootCount()).toBe(0)
    expect(seen.live).toBe(0)
  })

  it('unmounts the React root when the Angular host destroys the component', async () => {
    const { ref, element } = await renderHost()
    await within(element).findByRole('button', { name: 'Clicks: 1' })

    ref.instance.shown.set(false)

    await waitFor(() => {
      expect(seen.live).toBe(0)
    })
    expect(within(element).queryByRole('button')).not.toBeInTheDocument()
    expect(element.querySelector(`[${SCOPE_ATTRIBUTE}]`)).toBeNull()
    expect(overlayRootCount()).toBe(0)
  })
})
