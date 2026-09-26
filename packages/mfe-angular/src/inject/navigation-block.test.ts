import { Component, runInInjectionContext, signal } from '@angular/core'
import {
  createNavigationIntent,
  parseBoundaryLocation,
  type BoundaryNavigator,
} from '@company/mfe-runtime'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createWidget } from '../definition.ts'
import {
  createHostApplication,
  createMfeTestEnvironment,
  mountWidget,
  type MountedTestWidget,
} from '../testing/index.ts'
import {
  injectNavigationBlock,
  type NavigationBlock,
  type NavigationBlockOptions,
  type ShouldBlockNavigation,
} from './navigation-block.ts'

@Component({ selector: 'test-form', template: '' })
class FormComponent {}

const formWidget = createWidget({
  id: 'order-form',
  inputSchema: z.object({}),
  outputSchema: z.object({}),
  component: FormComponent,
})

async function blockingWidget(
  shouldBlock: ShouldBlockNavigation,
  options?: NavigationBlockOptions,
): Promise<{ widget: MountedTestWidget; block: NavigationBlock; navigator: BoundaryNavigator }> {
  const widget = await mountWidget(formWidget, { initialEntries: ['/orders'] })
  const block = runInInjectionContext(widget.injector, () =>
    injectNavigationBlock(shouldBlock, options),
  )
  return { widget, block, navigator: widget.environment.runtime.navigator }
}

function request(navigator: BoundaryNavigator, to: string, commit: () => void) {
  return navigator.requestNavigation(
    createNavigationIntent(navigator.read(), parseBoundaryLocation(to), '/orders'),
    commit,
  )
}

describe('injectNavigationBlock in a Widget', () => {
  it('lets a navigation through when the Widget has nothing to lose', async () => {
    const { navigator } = await blockingWidget(false)
    const commit = vi.fn()

    await expect(request(navigator, '/elsewhere', commit)).resolves.toBe('proceeded')
    expect(commit).toHaveBeenCalledOnce()
  })

  it('holds a navigation until the Widget answers, and commits on proceed', async () => {
    const { block, navigator } = await blockingWidget(true)
    const commit = vi.fn()

    const outcome = request(navigator, '/elsewhere', commit)
    await Promise.resolve()
    expect(block.pending()?.to.pathname).toBe('/elsewhere')
    expect(commit).not.toHaveBeenCalled()

    block.proceed()

    await expect(outcome).resolves.toBe('proceeded')
    expect(commit).toHaveBeenCalledOnce()
    expect(block.pending()).toBeNull()
  })

  it('abandons the navigation when the Widget says stay', async () => {
    const { block, navigator } = await blockingWidget(true)
    const commit = vi.fn()

    const outcome = request(navigator, '/elsewhere', commit)
    await Promise.resolve()
    block.stay()

    await expect(outcome).resolves.toBe('blocked')
    expect(commit).not.toHaveBeenCalled()
  })

  it('is asked per navigation by a predicate, and follows a signal’s current value', async () => {
    const leaving = await blockingWidget(intent => intent.to.pathname.startsWith('/admin'))
    await expect(request(leaving.navigator, '/orders/2', () => undefined)).resolves.toBe(
      'proceeded',
    )
    await leaving.widget.dispose()

    const dirty = signal(false)
    const tracked = await blockingWidget(dirty)
    await expect(request(tracked.navigator, '/elsewhere', () => undefined)).resolves.toBe(
      'proceeded',
    )
    dirty.set(true)
    const outcome = request(tracked.navigator, '/elsewhere', () => undefined)
    await Promise.resolve()
    expect(tracked.block.pending()).not.toBeNull()
    tracked.block.stay()
    await expect(outcome).resolves.toBe('blocked')
  })

  it('never strands the host when the Widget is disposed mid-negotiation', async () => {
    const { widget, navigator } = await blockingWidget(true)
    const commit = vi.fn()

    const outcome = request(navigator, '/elsewhere', commit)
    await Promise.resolve()
    await widget.dispose()

    await expect(outcome).resolves.toBe('proceeded')
    expect(navigator.blockerCount).toBe(0)
  })

  it('offers the reload prompt while blocking, unless told not to', async () => {
    const blocking = await blockingWidget(true)
    expect(blocking.navigator.wantsUnloadPrompt()).toBe(true)
    await blocking.widget.dispose()

    const quiet = await blockingWidget(true, { unloadPrompt: false })
    expect(quiet.navigator.wantsUnloadPrompt()).toBe(false)
    await quiet.widget.dispose()

    const clean = await blockingWidget(signal(false))
    expect(clean.navigator.wantsUnloadPrompt()).toBe(false)
  })

  it('requires a mount, because the host negotiates with mounts', async () => {
    const environment = createMfeTestEnvironment()
    const appRef = await createHostApplication(environment)

    expect(() =>
      runInInjectionContext(appRef.injector, () => injectNavigationBlock(true)),
    ).toThrowError(
      /failed to call injectNavigationBlock\(\): expected a component or service created inside an App or Widget mount/,
    )
    environment.dispose()
  })
})
