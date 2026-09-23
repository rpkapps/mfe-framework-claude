/**
 * A real React Widget placed by an Angular host's `<mfe-widget>`. The runtime appends the mount's
 * scope root to the element the Angular host renders, and the React definition opens a React root
 * of its own inside it, with the same provider-side validation it has in a React host.
 */

import { MOUNT_ATTRIBUTE, OVERLAY_ROOT_ATTRIBUTE } from '@company/mfe-angular/host'
import { fireEvent, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  createPageRuntime,
  expectedScope,
  expectReleased,
  overlayRootCount,
  placeInAngularHost,
  scopeOf,
  scopeRootCount,
  watchMounts,
} from './__tests__/harness.ts'
import { counter, counterRoots } from './fixtures/counter.ts'

async function placeCounter(
  inputs: Readonly<Record<string, unknown>> = { label: 'Clicks', count: 1 },
) {
  const memory = createPageRuntime({ definitions: [counter] })
  return { memory, ...(await placeInAngularHost(memory.runtime, 'counter', inputs)) }
}

describe('a React Widget placed by an Angular <mfe-widget>', () => {
  it('renders in the one scope root the runtime created for it inside the Angular host', async () => {
    const { element } = await placeCounter()

    const button = await within(element).findByRole('button', { name: 'Clicks: 1' })

    // The runtime appends one scope root per mount, and no adapter renders one of its own.
    expect(scopeRootCount(element)).toBe(1)
    const scope = scopeOf(button)
    expect(scope).toEqual(expectedScope('counter', 'widget'))
    // Its overlay root is the only one on the page.
    expect(overlayRootCount()).toBe(1)
    expect(
      document.querySelector(`[${OVERLAY_ROOT_ATTRIBUTE}]`)?.getAttribute(MOUNT_ATTRIBUTE),
    ).toBe(scope?.mount)
    expect(counterRoots.live).toBe(1)
  })

  it('re-renders with a changed inputs binding, and not for an equal one', async () => {
    const mounts = watchMounts(counter)
    const { ref, appRef, element } = await placeCounter()
    await within(element).findByRole('button', { name: 'Clicks: 1' })
    await mounts.whenStable()
    const mounted = counterRoots.commits

    ref.instance.inputs.set({ label: 'Clicks', count: 2 })
    // Angular's change detection hands the binding to the mount, and the React root commits it.
    await appRef.whenStable()
    await mounts.whenStable()

    expect(within(element).getByRole('button', { name: 'Clicks: 2' })).toBeInTheDocument()
    expect(counterRoots.commits).toBe(mounted + 1)

    // A new object with the same values: Angular binds it, and the Widget has nothing to render.
    ref.instance.inputs.set({ label: 'Clicks', count: 2 })
    await appRef.whenStable()
    await mounts.whenStable()

    expect(counterRoots.commits).toBe(mounted + 1)
    expect(counterRoots.live).toBe(1)
  })

  it('delivers what the React Widget emits to the (event) output as { name, payload }', async () => {
    const { ref, element } = await placeCounter()

    fireEvent.click(await within(element).findByRole('button', { name: 'Clicks: 1' }))

    expect(ref.instance.events).toEqual([{ name: 'bumped', payload: { count: 2 } }])
  })

  it('reports first inputs the React Widget refuses through the (failed) output', async () => {
    const { ref, memory } = await placeCounter({ label: 'Clicks', count: 'one' })

    await waitFor(() => {
      expect(ref.instance.failures).toHaveLength(1)
    })
    expect(ref.instance.failures[0]).toMatchObject({
      code: 'contract/input-mismatch',
      id: 'counter',
    })
    expect(counterRoots.live).toBe(0)
    expectReleased(memory.runtime)
  })

  it('unmounts the React root when the Angular host destroys the component', async () => {
    const { ref, element, memory } = await placeCounter()
    await within(element).findByRole('button', { name: 'Clicks: 1' })

    ref.instance.shown.set(false)

    await waitFor(() => {
      expect(counterRoots.live).toBe(0)
    })
    expect(within(element).queryByRole('button')).not.toBeInTheDocument()
    expectReleased(memory.runtime)
  })
})
