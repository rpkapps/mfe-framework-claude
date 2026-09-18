import { describe, expect, it, vi } from 'vitest'

import {
  createLegacyMigrationSeam,
  createLegacyShellNavigationInitializer,
  skipLocationChangeOnNonImperativeTriggers,
  type LegacyNavigation,
  type LegacyRouterEvent,
  type LegacyRouterPort,
} from './migration-provider.ts'

/**
 * Stands in for Angular's `Router`. It is the whole surface the seam touches,
 * which is what lets the migration be verified without Angular in the
 * workspace. The legacy applications are not available here, so this encodes
 * the contract they are expected to honour rather than observing them.
 */
function createRouterDouble(navigation: LegacyNavigation | null = { extras: {} }): {
  readonly router: LegacyRouterPort
  readonly emit: (event: LegacyRouterEvent) => void
  readonly unsubscribe: ReturnType<typeof vi.fn>
  readonly navigation: LegacyNavigation | null
  readonly subscriberCount: () => number
} {
  const listeners: ((event: LegacyRouterEvent) => void)[] = []
  const unsubscribe = vi.fn(() => {
    listeners.length = 0
  })

  const router: LegacyRouterPort = {
    events: {
      subscribe: next => {
        listeners.push(next)
        return { unsubscribe }
      },
    },
    getCurrentNavigation: () => navigation,
  }

  return {
    router,
    emit: event => {
      for (const listener of [...listeners]) listener(event)
    },
    unsubscribe,
    navigation,
    subscriberCount: () => listeners.length,
  }
}

describe('skipLocationChangeOnNonImperativeTriggers', () => {
  it('stops Angular writing the URL when the browser triggered the navigation', () => {
    const double = createRouterDouble()
    skipLocationChangeOnNonImperativeTriggers(double.router)

    double.emit({ navigationTrigger: 'popstate', id: 2, url: '/asset-tracker/sites' })

    expect(double.navigation?.extras.skipLocationChange).toBe(true)
  })

  it('stops Angular writing the URL for a hash change too', () => {
    const double = createRouterDouble()
    skipLocationChangeOnNonImperativeTriggers(double.router)

    double.emit({ navigationTrigger: 'hashchange' })

    expect(double.navigation?.extras.skipLocationChange).toBe(true)
  })

  it('leaves a navigation the app started alone, so in-app links still update the URL', () => {
    const double = createRouterDouble()
    skipLocationChangeOnNonImperativeTriggers(double.router)

    double.emit({ navigationTrigger: 'imperative' })

    expect(double.navigation?.extras.skipLocationChange).toBeUndefined()
  })

  it('ignores router events that are not navigation starts', () => {
    const double = createRouterDouble()
    skipLocationChangeOnNonImperativeTriggers(double.router)

    double.emit({ id: 3, url: '/asset-tracker' })

    expect(double.navigation?.extras.skipLocationChange).toBeUndefined()
  })

  it('does nothing when the router reports no navigation in flight', () => {
    const double = createRouterDouble(null)
    skipLocationChangeOnNonImperativeTriggers(double.router)

    expect(() => double.emit({ navigationTrigger: 'popstate' })).not.toThrow()
  })

  it('releases the subscription when the app tears the seam down', () => {
    const double = createRouterDouble()
    const teardown = skipLocationChangeOnNonImperativeTriggers(double.router)

    teardown()

    expect(double.unsubscribe).toHaveBeenCalledTimes(1)
    expect(double.subscriberCount()).toBe(0)
  })
})

describe('createLegacyShellNavigationInitializer', () => {
  it('does not touch the router until Angular runs the initializer', () => {
    const double = createRouterDouble()
    const injectRouter = vi.fn(() => double.router)

    const initializer = createLegacyShellNavigationInitializer({
      name: 'asset-tracker',
      injectRouter,
    })

    expect(injectRouter).not.toHaveBeenCalled()
    expect(double.subscriberCount()).toBe(0)

    initializer()

    expect(injectRouter).toHaveBeenCalledTimes(1)
    expect(double.subscriberCount()).toBe(1)
  })

  it('returns nothing, so Angular does not wait on the initializer', () => {
    const double = createRouterDouble()
    const initializer = createLegacyShellNavigationInitializer({
      name: 'asset-tracker',
      injectRouter: () => double.router,
    })

    expect(initializer()).toBeUndefined()
  })

  it('wires shell-owned navigation once it runs', () => {
    const double = createRouterDouble()
    const initializer = createLegacyShellNavigationInitializer({
      name: 'rigstream',
      injectRouter: () => double.router,
    })

    initializer()
    double.emit({ navigationTrigger: 'popstate' })

    expect(double.navigation?.extras.skipLocationChange).toBe(true)
  })

  it('hands the teardown to the app so it can tie it to the injector', () => {
    const double = createRouterDouble()
    const registerTeardown = vi.fn()
    const initializer = createLegacyShellNavigationInitializer({
      name: 'rigstream',
      injectRouter: () => double.router,
      registerTeardown,
    })

    initializer()
    const teardown = registerTeardown.mock.calls[0]?.[0] as () => void
    teardown()

    expect(double.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('carries the seam so the app reads its base href from the same object', () => {
    const initializer = createLegacyShellNavigationInitializer({
      name: 'asset-tracker',
      injectRouter: () => createRouterDouble().router,
    })

    expect(initializer.seam.appBaseHref).toBe('/asset-tracker/')
  })
})

describe('createLegacyMigrationSeam', () => {
  it('preserves the base href an app pins for itself', () => {
    const seam = createLegacyMigrationSeam({ name: 'asset-tracker' })

    expect(seam.appBaseHref).toBe('/asset-tracker/')
    expect(seam.baseHref.source).toBe('app-pinned')
  })

  it('preserves a base href delegated by single-spa', () => {
    const seam = createLegacyMigrationSeam({ name: 'rigstream', baseHref: '/rigstream/v2/' })

    expect(seam.appBaseHref).toBe('/rigstream/v2/')
    expect(seam.baseHref.source).toBe('single-spa')
  })

  it('preserves the documented fallback when single-spa supplies nothing', () => {
    const seam = createLegacyMigrationSeam({ name: 'rigstream' })

    expect(seam.appBaseHref).toBe('/rigstream/')
    expect(seam.baseHref.source).toBe('fallback')
  })

  it('declares shell-owned navigation, unlike a new App', () => {
    expect(createLegacyMigrationSeam({ name: 'rigstream' }).navigationOwnership).toBe('shell')
  })

  it('preserves the parcel expose path the shell still loads', () => {
    expect(createLegacyMigrationSeam({ name: 'rigstream' }).parcelExposeName).toBe(
      './single-spa-app',
    )
  })

  it('preserves the route metadata from the registry entry', () => {
    const seam = createLegacyMigrationSeam({
      name: 'asset-tracker',
      routes: ['/asset-tracker', '/asset-tracker/sites'],
      settingsRoutes: ['/asset-tracker/settings'],
    })

    expect(seam.routes).toEqual(['/asset-tracker', '/asset-tracker/sites'])
    expect(seam.settingsRoutes).toEqual(['/asset-tracker/settings'])
  })

  it('keeps the single-spa activity aligned with the resolved base href', () => {
    const seam = createLegacyMigrationSeam({ name: 'asset-tracker' })

    expect(seam.activeWhen('/asset-tracker')).toBe(true)
    expect(seam.activeWhen('/asset-tracker/sites/42')).toBe(true)
    expect(seam.activeWhen('/asset-tracker/settings?tab=alerts')).toBe(true)
    expect(seam.activeWhen('/rigstream')).toBe(false)
    expect(seam.activeWhen('/asset-tracker-archive')).toBe(false)
  })

  it('derives the activity from a delegated base href, not from the app name', () => {
    const seam = createLegacyMigrationSeam({ name: 'rigstream', baseHref: '/solutions/rigstream/' })

    expect(seam.activeWhen('/solutions/rigstream/wells')).toBe(true)
    expect(seam.activeWhen('/rigstream/wells')).toBe(false)
  })

  it('names the single provider the app replaces', () => {
    expect(createLegacyMigrationSeam({ name: 'rigstream' }).replaces).toBe(
      'provideAppInitializer(skipLocationChangeOnNonImperativeRoutingTriggers)',
    )
  })
})
