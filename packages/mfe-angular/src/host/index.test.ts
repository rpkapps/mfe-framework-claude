import { runInInjectionContext } from '@angular/core'
import type { MfeAdapter } from '@company/mfe-core'
import * as runtimeSurface from '@company/mfe-runtime'
import {
  createInProcessLoader,
  createRecordingTelemetryProvider,
} from '@company/mfe-runtime/testing'
import { describe, expect, it } from 'vitest'

import { injectMfeRuntime } from '../inject/runtime.ts'
import { angularAdapter } from '../registry/angular-adapter.ts'
import { createHostApplication } from '../testing/index.ts'
import * as hostSurface from './index.ts'

const angularEntry = {
  id: 'reports',
  kind: 'app',
  mfe: { contractMajor: 1, framework: 'angular' },
  manifestUrl: 'https://cdn.example.test/reports/mf-manifest.json',
  container: 'example_reports',
}

/** Another framework's build, which the Angular adapter never claims. */
const otherEntry = {
  ...angularEntry,
  id: 'orders',
  mfe: { contractMajor: 1, framework: 'other' },
}

function runtimeOver(adapters: readonly MfeAdapter[]) {
  return hostSurface.createMfeRuntime({
    registryEntries: [angularEntry, otherEntry],
    loader: createInProcessLoader(new Map()),
    shellState: { user: null, groups: [], theme: 'light' },
    telemetryProvider: createRecordingTelemetryProvider(),
    adapters,
    sessionGeneration: 'test-session',
  })
}

describe('@company/mfe-angular/host', () => {
  it('is the runtime’s own surface, binding for binding, plus provideMfeRuntime', () => {
    const extra = Object.keys(hostSurface).filter(name => !(name in runtimeSurface))

    expect(extra).toEqual(['provideMfeRuntime'])
    for (const [name, value] of Object.entries(runtimeSurface)) {
      expect(hostSurface[name as keyof typeof hostSurface], name).toBe(value)
    }
  })

  it('reads Angular entries when the shell lists the Angular adapter, and nothing implicitly', () => {
    const withAngular = runtimeOver([angularAdapter])
    const without = runtimeOver([])

    expect([...withAngular.runtime.registry.entries.keys()]).toEqual(['reports'])
    expect(
      withAngular.runtime.registry.rejected.map(({ id, reason }) => `${id}: ${reason}`),
    ).toEqual(['orders: no adapter recognised this entry'])
    expect(without.runtime.registry.entries.size).toBe(0)
    withAngular.dispose()
    without.dispose()
  })

  it('reads another framework’s entries through the adapter the shell lists beside it', () => {
    const otherFramework: MfeAdapter = {
      kind: 'other',
      detect: raw =>
        typeof raw === 'object' && raw !== null && (raw as { id?: unknown }).id === 'orders',
      parse: () => ({
        id: 'orders',
        definitionKind: 'app',
        adapter: 'other',
        manifestUrl: otherEntry.manifestUrl,
      }),
      is: (entry): entry is never => entry.adapter === 'other',
    }

    const handle = runtimeOver([angularAdapter, otherFramework])

    expect([...handle.runtime.registry.entries.keys()].sort()).toEqual(['orders', 'reports'])
    handle.dispose()
  })
})

describe('provideMfeRuntime', () => {
  it('makes the runtime reachable from a host application outside any mount', async () => {
    const handle = runtimeOver([angularAdapter])
    const appRef = await createHostApplication(null, [
      hostSurface.provideMfeRuntime(handle.runtime),
    ])

    expect(runInInjectionContext(appRef.injector, () => injectMfeRuntime())).toBe(handle.runtime)
    handle.dispose()
  })
})
