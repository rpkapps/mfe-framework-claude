import { Component } from '@angular/core'
import type { FederationRuntime } from '@company/mfe-runtime'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createWidget } from '../definition.ts'
import { angularAdapter } from '../registry/angular-adapter.ts'
import { createMf2ContainerLoader } from './federation-loader.ts'

@Component({ selector: 'test-noop', template: '' })
class NoopComponent {}

const alertWidget = createWidget({
  id: 'alert-panel',
  inputs: z.object({}),
  events: {},
  component: NoopComponent,
})

describe('createMf2ContainerLoader', () => {
  it('loads an Angular definition from the expose path its entry names, registering once', async () => {
    const loadRemote = vi.fn((_id: string): Promise<unknown> => Promise.resolve({ alertWidget }))
    const federation: FederationRuntime = {
      registerRemotes: vi.fn(),
      loadRemote: <T>(id: string) => loadRemote(id) as Promise<T | null>,
    }
    const loader = createMf2ContainerLoader({ runtime: federation })
    const entry = angularAdapter.parse({
      id: 'alert-panel',
      kind: 'widget',
      mfe: { contractMajor: 1, framework: 'angular' },
      manifestUrl: 'https://cdn.example.test/alerts/mf-manifest.json',
      container: 'example_alerts',
    })
    const signal = new AbortController().signal

    const first = await loader.load(entry, { signal })
    await loader.load(entry, { signal })

    expect(first.module).toBe(alertWidget)
    expect(first.identity).toEqual({ id: 'alert-panel', kind: 'widget' })
    expect(loadRemote).toHaveBeenCalledWith('example_alerts/widgets/alert-panel')
    expect(federation.registerRemotes).toHaveBeenCalledOnce()
  })
})
