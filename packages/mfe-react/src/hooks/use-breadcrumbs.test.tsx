/**
 * The override replaces the App's own portion of the trail — and an empty array
 * is no override rather than an override with nothing in it.
 *
 * That distinction is the whole test. `useBreadcrumbs(inFlow ? steps : [])` is
 * the shape every caller writes, and under the other reading it deleted the
 * App's route-derived crumbs for the entire time the flow was not running.
 */

import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useState, type ReactNode } from 'react'
import type { BreadcrumbItem } from '@company/mfe-core'

import { MfeProvider } from '../runtime-context.tsx'
import { createMfeTestEnvironment, type MfeTestEnvironment } from '../testing/index.tsx'
import { useBreadcrumbs } from './use-breadcrumbs.ts'

let environment: MfeTestEnvironment | null = null

afterEach(async () => {
  const current = environment
  environment = null
  await current?.dispose()
})

const FLOW: readonly BreadcrumbItem[] = [
  { key: 'wizard', label: 'New study' },
  { key: 'step-2', label: 'Step 2' },
]

function Wizard(): ReactNode {
  const [inFlow, setInFlow] = useState(false)
  useBreadcrumbs(inFlow ? FLOW : [])

  return (
    <button
      type="button"
      onClick={() => {
        setInFlow(current => !current)
      }}
    >
      toggle
    </button>
  )
}

/** The trail the shell would render, as plain labels. */
function labels(created: MfeTestEnvironment): readonly string[] {
  return created.runtime.breadcrumbs.getSnapshot().map(item => item.label)
}

describe('useBreadcrumbs', () => {
  it('leaves the route-derived crumbs alone until there is a flow to show', async () => {
    environment = createMfeTestEnvironment({ definitionId: 'lab', basePath: '/lab' })
    const created = environment

    // What the App's own route tree contributes, exactly as AppMount publishes it.
    const handle = created.runtime.breadcrumbs.registerMount('lab', created.mount.mountToken, 1)
    handle.update([{ key: 'breadcrumbs', label: 'Breadcrumbs' }])

    const Wrapper = created.wrapper
    render(
      <Wrapper>
        <Wizard />
      </Wrapper>,
    )

    await waitFor(() => {
      expect(labels(created)).toEqual(['Breadcrumbs'])
    })

    screen.getByRole('button', { name: 'toggle' }).click()
    await waitFor(() => {
      expect(labels(created)).toEqual(['New study', 'Step 2'])
    })

    // And back: clearing the override restores the route's own crumb rather
    // than leaving the App's portion empty.
    screen.getByRole('button', { name: 'toggle' }).click()
    await waitFor(() => {
      expect(labels(created)).toEqual(['Breadcrumbs'])
    })
  })

  it('clears the override when the component that owns it unmounts', async () => {
    environment = createMfeTestEnvironment({ definitionId: 'lab', basePath: '/lab' })
    const created = environment

    const handle = created.runtime.breadcrumbs.registerMount('lab', created.mount.mountToken, 1)
    handle.update([{ key: 'breadcrumbs', label: 'Breadcrumbs' }])

    const Wrapper = created.wrapper
    const view = render(
      <Wrapper>
        <Wizard />
      </Wrapper>,
    )

    screen.getByRole('button', { name: 'toggle' }).click()
    await waitFor(() => {
      expect(labels(created)).toEqual(['New study', 'Step 2'])
    })

    view.unmount()
    await waitFor(() => {
      expect(labels(created)).toEqual(['Breadcrumbs'])
    })
  })
})

/**
 * The same hook outside any mount, which is where a host's own trail comes
 * from. It had no way in before: the store is keyed by mount token and a host
 * has none, so a shell wanting the workspace and the mounted application in
 * the trail invented a token and registered itself as though it were a mount.
 */
describe('useBreadcrumbs outside a mount', () => {
  function Chrome({ items }: { readonly items: readonly BreadcrumbItem[] }): ReactNode {
    useBreadcrumbs(items)
    return null
  }

  const WORKSPACE: readonly BreadcrumbItem[] = [{ key: 'workspace', label: 'North Sea', href: '/' }]

  /** What an App's own route tree contributes, exactly as AppMount publishes it. */
  function withMountedApp(created: MfeTestEnvironment): void {
    const handle = created.runtime.breadcrumbs.registerMount('lab', created.mount.mountToken, 1)
    handle.update([{ key: 'breadcrumbs', label: 'Breadcrumbs' }])
  }

  it('composes the host’s crumbs above the mount’s', async () => {
    environment = createMfeTestEnvironment({ definitionId: 'lab', basePath: '/lab' })
    const created = environment
    withMountedApp(created)

    render(
      <MfeProvider runtime={created.runtime}>
        <Chrome items={WORKSPACE} />
      </MfeProvider>,
    )

    await waitFor(() => {
      expect(labels(created)).toEqual(['North Sea', 'Breadcrumbs'])
    })
  })

  it('republishes the host’s crumbs when they change', async () => {
    environment = createMfeTestEnvironment({ definitionId: 'lab', basePath: '/lab' })
    const created = environment

    const view = render(
      <MfeProvider runtime={created.runtime}>
        <Chrome items={WORKSPACE} />
      </MfeProvider>,
    )

    await waitFor(() => {
      expect(labels(created)).toEqual(['North Sea'])
    })

    view.rerender(
      <MfeProvider runtime={created.runtime}>
        <Chrome items={[...WORKSPACE, { key: 'lab', label: 'Lab' }]} />
      </MfeProvider>,
    )

    await waitFor(() => {
      expect(labels(created)).toEqual(['North Sea', 'Lab'])
    })
  })

  it('takes the host’s crumbs out of the trail when the chrome unmounts', async () => {
    environment = createMfeTestEnvironment({ definitionId: 'lab', basePath: '/lab' })
    const created = environment
    withMountedApp(created)

    const view = render(
      <MfeProvider runtime={created.runtime}>
        <Chrome items={WORKSPACE} />
      </MfeProvider>,
    )

    await waitFor(() => {
      expect(labels(created)).toEqual(['North Sea', 'Breadcrumbs'])
    })

    view.unmount()
    await waitFor(() => {
      expect(labels(created)).toEqual(['Breadcrumbs'])
    })
  })
})
