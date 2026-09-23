import { runInInjectionContext, signal } from '@angular/core'
import type { RegistryEntry } from '@company/mfe-core'
import type { MfeHostRuntime } from '@company/mfe-runtime'
import { describe, expect, it } from 'vitest'

import { createHostApplication } from '../__tests__/harness.ts'
import { createMfeTestEnvironment, type MfeTestEnvironment } from '../testing/index.ts'
import { provideMfeRuntime } from './provide-runtime.ts'
import {
  injectActiveDefinition,
  injectApps,
  injectCapabilityPages,
  injectRegistryEntries,
  injectWidgets,
} from './registry-selectors.ts'

function entry(id: string, fields: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    id,
    definitionKind: 'app',
    adapter: 'angular',
    manifestUrl: `https://cdn.example/${id}/mf-manifest.json`,
    ...fields,
  }
}

const entries: readonly RegistryEntry[] = [
  entry('reports', {
    capabilities: [
      { name: 'settings', label: 'Report settings', path: '/settings' },
      { name: 'help', label: 'Report help', path: '/help' },
    ],
  }),
  entry('admin', {
    hidden: true,
    capabilities: [{ name: 'settings', label: 'Admin settings', path: '/settings' }],
  }),
  entry('alert-panel', { definitionKind: 'widget' }),
  entry('secret-widget', { definitionKind: 'widget', hidden: true }),
]

/** The environment's own runtime over a registry the test writes, as a shell would read one. */
async function hostOver(registry: readonly RegistryEntry[]) {
  const environment: MfeTestEnvironment = createMfeTestEnvironment()
  const runtime: MfeHostRuntime = {
    ...environment.runtime,
    registry: { entries: new Map(registry.map(item => [item.id, item])), rejected: [] },
  }
  const appRef = await createHostApplication(null, [provideMfeRuntime(runtime)])
  return { appRef, environment }
}

describe('the registry selectors', () => {
  it('list every entry in order, and Apps and Widgets without the hidden ones', async () => {
    const { appRef } = await hostOver(entries)

    const views = runInInjectionContext(appRef.injector, () => ({
      all: injectRegistryEntries(),
      apps: injectApps(),
      widgets: injectWidgets(),
    }))

    expect(views.all().map(item => item.id)).toEqual([
      'reports',
      'admin',
      'alert-panel',
      'secret-widget',
    ])
    expect(views.apps().map(item => item.id)).toEqual(['reports'])
    expect(views.widgets().map(item => item.id)).toEqual(['alert-panel'])
    expect(views.apps()).toBe(views.apps())
  })

  it('flattens capability pages, filtered by capability when asked', async () => {
    const { appRef } = await hostOver(entries)

    const { every, settings } = runInInjectionContext(appRef.injector, () => ({
      every: injectCapabilityPages(),
      settings: injectCapabilityPages('settings'),
    }))

    expect(every().map(page => page.capability.label)).toEqual(['Report settings', 'Report help'])
    expect(settings().map(page => `${page.app.id}:${page.capability.label}`)).toEqual([
      'reports:Report settings',
    ])
  })

  it('names the App a location is inside, even a hidden one, and never a Widget', async () => {
    const { appRef } = await hostOver(entries)
    const location = signal('/')
    const active = runInInjectionContext(appRef.injector, () => injectActiveDefinition(location))

    expect(active()).toBeNull()

    location.set('/reports/42')
    expect(active()).toEqual({ id: 'reports', entry: entries[0] })

    location.set('/admin')
    expect(active()?.entry?.id).toBe('admin')

    location.set('/unknown/page')
    expect(active()).toEqual({ id: 'unknown', entry: undefined })

    location.set('/alert-panel')
    expect(active()).toEqual({ id: 'alert-panel', entry: undefined })
  })
})
