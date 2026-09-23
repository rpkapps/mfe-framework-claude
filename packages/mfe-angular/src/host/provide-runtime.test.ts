import { runInInjectionContext } from '@angular/core'
import type { MfeAdapter } from '@company/mfe-core'
import {
  createInProcessLoader,
  createRecordingTelemetryProvider,
} from '@company/mfe-runtime/testing'
import { describe, expect, it } from 'vitest'

import { createHostApplication } from '../__tests__/harness.ts'
import { injectMfeRuntime } from '../inject/runtime.ts'
import { createMfeRuntime, provideMfeRuntime } from './provide-runtime.ts'

const angularEntry = {
  id: 'reports',
  kind: 'app',
  mfe: { contractMajor: 1, framework: 'angular' },
  manifestUrl: 'https://cdn.example.test/reports/mf-manifest.json',
  container: 'example_reports',
}

/** A React build's entry names no framework, which the Angular adapter never claims. */
const reactEntry = { ...angularEntry, id: 'orders', mfe: { contractMajor: 1 } }

function runtimeOver(adapters?: readonly MfeAdapter[]) {
  return createMfeRuntime({
    registryEntries: [angularEntry, reactEntry],
    loader: createInProcessLoader(new Map()),
    shellState: { user: null, groups: [], theme: 'light' },
    telemetryProvider: createRecordingTelemetryProvider(),
    ...(adapters === undefined ? {} : { adapters }),
    sessionGeneration: 'test-session',
  })
}

describe('createMfeRuntime', () => {
  it('always reads Angular entries, and rejects what no registered adapter recognises', () => {
    const handle = runtimeOver()

    expect([...handle.runtime.registry.entries.keys()]).toEqual(['reports'])
    expect(handle.runtime.registry.rejected.map(({ id, reason }) => `${id}: ${reason}`)).toEqual([
      'orders: no adapter recognised this entry',
    ])
    handle.dispose()
  })

  it('reads another framework’s entries through an adapter the host adds', () => {
    const otherFramework: MfeAdapter = {
      kind: 'react',
      detect: raw =>
        typeof raw === 'object' && raw !== null && (raw as { id?: unknown }).id === 'orders',
      parse: () => ({
        id: 'orders',
        definitionKind: 'app',
        adapter: 'react',
        manifestUrl: reactEntry.manifestUrl,
      }),
      is: (entry): entry is never => entry.adapter === 'react',
    }

    const handle = runtimeOver([otherFramework])

    expect([...handle.runtime.registry.entries.keys()].sort()).toEqual(['orders', 'reports'])
    handle.dispose()
  })
})

describe('provideMfeRuntime', () => {
  it('makes the runtime reachable from a host application outside any mount', async () => {
    const handle = runtimeOver()
    const appRef = await createHostApplication(null, [provideMfeRuntime(handle.runtime)])

    expect(runInInjectionContext(appRef.injector, () => injectMfeRuntime())).toBe(handle.runtime)
    handle.dispose()
  })
})
