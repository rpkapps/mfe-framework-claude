import { stateCapabilities } from '@company/mfe-core/shared-state'
import { Component, createEnvironmentInjector, runInInjectionContext } from '@angular/core'
import { Router } from '@angular/router'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { SharedStateAdapter, StateContract } from '@company/mfe-core/shared-state'
import { createApp, createWidget } from '../definition.ts'
import { createMfeTestEnvironment, mountApp, mountWidget } from '../testing/index.ts'
import { createSharedStateBindings } from './shared-state.ts'

interface Values {
  units: 'metric' | 'imperial'
}
const bindings = createSharedStateBindings<Values>('reader')
const contract: StateContract = {
  formatVersion: 1,
  id: 'units',
  revision: 'units',
  node: {
    kind: 'default',
    inner: { kind: 'enum', values: ['metric', 'imperial'] },
    value: 'metric',
  },
}
const requirements = {
  protocolVersion: 1 as const,
  contracts: [{ id: 'units', revision: 'units', capabilities: stateCapabilities(contract.node) }],
}
function options() {
  let revision = 0
  let value: Values['units'] | undefined
  const adapter: SharedStateAdapter = {
    hydrate: () =>
      Promise.resolve([
        value === undefined ? { id: 'units', revision } : { id: 'units', revision, value },
      ]),
    write: operation => {
      value = operation.value as Values['units']
      return Promise.resolve({ id: 'units', revision: ++revision, value })
    },
  }
  return {
    scope: 'user/workspace',
    schema: { formatVersion: 1 as const, contracts: [contract] },
    adapter,
  }
}
@Component({ selector: 'shared-state-reader', template: '{{ units() }}' })
class ReaderComponent {
  readonly state = bindings.injectSharedState('units')
  readonly units = this.state[0]
}

describe('definition-bound Angular shared state', () => {
  it('renders reactive readonly signals and retains state on unmount/remount', async () => {
    const definition = createWidget({
      id: 'reader',
      sharedState: requirements,
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      component: ReaderComponent,
    })
    const environment = createMfeTestEnvironment({
      definitions: [definition],
      sharedState: options(),
    })
    const mounted = await mountWidget(definition, { environment })
    expect(mounted.element.textContent).toContain('metric')
    const [value, set] = runInInjectionContext(mounted.injector, () =>
      bindings.injectSharedState('units'),
    )
    expect(value()).toBe('metric')
    await set('imperial')
    await mounted.whenStable()
    expect(value()).toBe('imperial')
    expect(mounted.element.textContent).toContain('imperial')
    await mounted.dispose()
    const remounted = await mountWidget(definition, { environment })
    expect(remounted.element.textContent).toContain('imperial')
    await remounted.dispose()
    environment.dispose()
  })
  it('unsubscribes at injector destruction without deleting shell state', async () => {
    const definition = createWidget({
      id: 'reader',
      sharedState: requirements,
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      component: ReaderComponent,
    })
    const mounted = await mountWidget(definition, { sharedState: options() })
    const child = createEnvironmentInjector([], mounted.injector)
    const value = runInInjectionContext(child, () => bindings.injectSharedState('units')[0])
    const store = runInInjectionContext(mounted.injector, () => bindings.injectSharedStateStore())
    child.destroy()
    await store.set('units', 'imperial')
    expect(value()).toBe('metric')
    expect(store.get('units')).toBe('imperial')
    await mounted.dispose()
  })
  it('allows route resolvers and guards to access the prepared store', async () => {
    const resolver = vi.fn(() => bindings.injectSharedStateStore().get('units'))
    const definition = createApp({
      id: 'reader',
      sharedState: requirements,
      routes: [
        {
          path: '',
          component: ReaderComponent,
          canActivate: [() => bindings.injectSharedStateStore().get('units') === 'metric'],
          resolve: { units: resolver },
        },
      ],
    })
    const mounted = await mountApp(definition, { sharedState: options() })
    expect(resolver).toHaveBeenCalled()
    expect(mounted.injector.get(Router).routerState.snapshot.root.firstChild?.data['units']).toBe(
      'metric',
    )
    await mounted.dispose()
  })
  it('rejects wrong-definition and outside-injection-context access', () => {
    expect(() => bindings.injectSharedStateStore()).toThrow()
  })
})
