import {
  Component,
  Injectable,
  inject,
  computed,
  createEnvironmentInjector,
  effect,
  isSignal,
  runInInjectionContext,
} from '@angular/core'
import { Router } from '@angular/router'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { z } from 'zod'
import type { Json, StateRecord, UserContextAdapter } from '@company/mfe-core/user-context'
import { createApp, createWidget } from '../definition.ts'
import { createMfeTestEnvironment, mountApp, mountWidget } from '../testing/index.ts'
import { createUserContextBindings, type UserContextValuesOf } from './user-context.ts'

const schema = z.strictObject({
  preferences: z
    .strictObject({
      appearance: z.strictObject({ theme: z.string(), fontSize: z.number() }),
    })
    .default({ appearance: { theme: 'light', fontSize: 14 } }),
  units: z.enum(['metric', 'imperial']).default('metric'),
})
type Values = UserContextValuesOf<{ schema: typeof schema }>
const userContext = { schema }
const bindings = createUserContextBindings<Values>('reader')
/** A server that replaces each submitted key of the owner's record. */
function options() {
  const records = new Map<string, StateRecord>()
  const read = (id: string): StateRecord => records.get(id) ?? { id, revision: 0 }
  const adapter: UserContextAdapter = {
    hydrate: ids => Promise.resolve(ids.map(read)),
    write: ({ id, value }) => {
      const current = read(id)
      const next = {
        id,
        revision: current.revision + 1,
        value: { ...(current.value as Record<string, Json> | undefined), ...value },
      }
      records.set(id, next)
      return Promise.resolve(next)
    },
  }
  return { adapter }
}
@Component({ selector: 'user-context-reader', template: '{{ context.value() }}' })
class ReaderComponent {
  readonly context = bindings.injectUserContext(values => values.units)
}

describe('definition-bound Angular user context', () => {
  it('renders reactive readonly signals and retains state on unmount/remount', async () => {
    const definition = createWidget({
      id: 'reader',
      userContext,
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      component: ReaderComponent,
    })
    const environment = createMfeTestEnvironment({
      definitions: [definition],
      userContext: options(),
    })
    const mounted = await mountWidget(definition, { environment })
    expect(mounted.element.textContent).toContain('metric')
    const context = runInInjectionContext(mounted.injector, () =>
      bindings.injectUserContext(values => values.units),
    )
    expect(context.value()).toBe('metric')
    expect(isSignal(context.value)).toBe(true)
    expect(Object.isFrozen(context)).toBe(true)
    expect(() =>
      runInInjectionContext(mounted.injector, () =>
        createUserContextBindings<Values>('different-definition').injectUserContext(
          values => values.units,
        ),
      ),
    ).toThrowError(expect.objectContaining({ code: 'user-context/undeclared' }))
    expect(await context.set('units', 'imperial')).toEqual({ ok: true, value: 'imperial' })
    await mounted.whenStable()
    expect(context.value()).toBe('imperial')
    expect(mounted.element.textContent).toContain('imperial')
    await mounted.dispose()
    const remounted = await mountWidget(definition, { environment })
    expect(remounted.element.textContent).toContain('imperial')
    await remounted.dispose()
    environment.dispose()
  })
  it('keeps the selected value for sibling changes so computed signals and effects do not rerun', async () => {
    const selector = (context: Readonly<Values>) => context.preferences.appearance.theme
    const render = vi.fn()
    const labelled = vi.fn()
    @Component({ selector: 'nested-reader', template: '{{ label() }}' })
    class NestedReader {
      readonly theme = bindings.injectUserContext(selector)
      readonly label = computed(() => {
        labelled()
        return `Theme: ${this.theme.value()}`
      })
      constructor() {
        effect(() => {
          render(this.theme.value())
        })
      }
    }
    const definition = createWidget({
      id: 'reader',
      userContext,
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      component: NestedReader,
    })
    const mounted = await mountWidget(definition, { userContext: options() })
    const commands = runInInjectionContext(mounted.injector, () =>
      bindings.injectUserContext(values => values.units),
    )
    const stableSetter = commands.set
    await mounted.whenStable()
    expect(mounted.element.textContent).toBe('Theme: light')
    render.mockClear()
    labelled.mockClear()
    await commands.set('preferences', { appearance: { theme: 'light', fontSize: 18 } })
    await mounted.whenStable()
    expect(render).not.toHaveBeenCalled()
    expect(labelled).not.toHaveBeenCalled()
    expect(mounted.element.textContent).toBe('Theme: light')
    await commands.set('preferences', { appearance: { theme: 'dark', fontSize: 18 } })
    await mounted.whenStable()
    expect(render).toHaveBeenCalledExactlyOnceWith('dark')
    expect(mounted.element.textContent).toBe('Theme: dark')
    expect(commands.set).toBe(stableSetter)
    await mounted.dispose()
  })
  it('unsubscribes at injector destruction without deleting shell state', async () => {
    const definition = createWidget({
      id: 'reader',
      userContext,
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      component: ReaderComponent,
    })
    const mounted = await mountWidget(definition, { userContext: options() })
    const child = createEnvironmentInjector([], mounted.injector)
    const select = vi.fn((context: Readonly<Values>) => context.units)
    const context = runInInjectionContext(child, () => bindings.injectUserContext(select))
    const store = runInInjectionContext(mounted.injector, () =>
      bindings.injectUserContext(values => values.units),
    )
    child.destroy()
    select.mockClear()
    await store.set('units', 'imperial')
    expect(context.value()).toBe('metric')
    expect(select).not.toHaveBeenCalled()
    expect(store.value()).toBe('imperial')
    await mounted.dispose()
  })
  it.each(['user change', 'mount disposal'] as const)(
    'rejects a saved binding after injector destruction followed by %s',
    async transition => {
      @Component({ selector: 'empty-reader', template: '' })
      class EmptyReader {}
      const definition = createWidget({
        id: 'reader',
        userContext,
        inputSchema: z.object({}),
        outputSchema: z.object({}),
        component: EmptyReader,
      })
      const mounted = await mountWidget(definition, { userContext: options() })
      const child = createEnvironmentInjector([], mounted.injector)
      const context = runInInjectionContext(child, () =>
        bindings.injectUserContext(values => values.units),
      )
      expect(context.value()).toBe('metric')
      child.destroy()
      if (transition === 'user change') {
        mounted.environment.setShellState({ user: { id: 'another-user', name: 'Another' } })
      } else {
        await mounted.dispose()
      }
      expect(() => context.value()).toThrowError(
        expect.objectContaining({ code: 'user-context/scope-disposed' }),
      )
      if (transition === 'user change') await mounted.dispose()
    },
  )
  it('reads a declared foreign owner reactively without a setter', async () => {
    const owner = createWidget({
      id: 'reader',
      userContext,
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      component: ReaderComponent,
    })
    const observerBindings = createUserContextBindings<Record<string, never>, { reader: Values }>(
      'observer',
    )
    @Component({ selector: 'context-observer', template: '{{ context.value() }}' })
    class ObserverComponent {
      readonly context = observerBindings.injectUserContext('reader', values => values.units)
    }
    const observer = createWidget({
      id: 'observer',
      userContext: { reads: { reader: schema } },
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      component: ObserverComponent,
    })
    const environment = createMfeTestEnvironment({
      definitions: [owner, observer],
      userContext: options(),
    })
    const mountedOwner = await mountWidget(owner, { environment })
    const mountedObserver = await mountWidget(observer, { environment })
    const foreign = runInInjectionContext(mountedObserver.injector, () =>
      observerBindings.injectUserContext('reader', values => values.units),
    )
    expect('set' in foreign).toBe(false)
    expectTypeOf(foreign).not.toHaveProperty('set')
    expectTypeOf(foreign.value()).toEqualTypeOf<Values['units']>()
    expect(Object.keys(foreign)).toEqual(['value'])
    expectTypeOf(bindings).not.toHaveProperty('injectUserContextStore')
    expect(foreign.value()).toBe('metric')
    const store = runInInjectionContext(mountedOwner.injector, () =>
      bindings.injectUserContext(values => values.units),
    )
    await store.set('units', 'imperial')
    await mountedObserver.whenStable()
    expect(foreign.value()).toBe('imperial')
    expect(mountedObserver.element.textContent).toContain('imperial')
    expect(() =>
      runInInjectionContext(mountedObserver.injector, () =>
        // @ts-expect-error: undeclared owner IDs are rejected by the generated map
        observerBindings.injectUserContext('undeclared', () => ''),
      ),
    ).toThrow()
    await mountedObserver.dispose()
    await mountedOwner.dispose()
    environment.dispose()
  })
  it('invalidates a mounted template when the signed-in user changes', async () => {
    @Component({ selector: 'scope-reader', template: '{{ read() }}' })
    class ScopeReader {
      readonly context = bindings.injectUserContext(values => values.units)
      read() {
        try {
          return this.context.value()
        } catch (error) {
          return (error as { code: string }).code
        }
      }
    }
    const definition = createWidget({
      id: 'reader',
      userContext,
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      component: ScopeReader,
    })
    const mounted = await mountWidget(definition, { userContext: options() })
    expect(mounted.element.textContent).toContain('metric')
    mounted.environment.setShellState({ user: { id: 'another-user', name: 'Another' } })
    await mounted.whenStable()
    expect(mounted.element.textContent).not.toContain('metric')
    expect(mounted.element.textContent).toContain('user-context/scope-disposed')
    await mounted.dispose()
  })
  it('allows route resolvers and guards to access the prepared store', async () => {
    const select = vi.fn((context: Readonly<Values>) => context.units)
    @Injectable()
    class UserPreferences {
      readonly units = bindings.injectUserContext(select).value
    }
    const resolver = vi.fn(() => inject(UserPreferences).units())
    const definition = createApp({
      id: 'reader',
      userContext,
      providers: [UserPreferences],
      routes: [
        {
          path: '',
          component: ReaderComponent,
          canActivate: [() => inject(UserPreferences).units() === 'metric'],
          resolve: { units: resolver },
        },
      ],
    })
    const mounted = await mountApp(definition, { userContext: options() })
    expect(resolver).toHaveBeenCalled()
    const calls = select.mock.calls.length
    expect(runInInjectionContext(mounted.injector, resolver)).toBe('metric')
    expect(runInInjectionContext(mounted.injector, resolver)).toBe('metric')
    expect(select).toHaveBeenCalledTimes(calls)
    expect(mounted.injector.get(Router).routerState.snapshot.root.firstChild?.data['units']).toBe(
      'metric',
    )
    await mounted.dispose()
  })
  it('rejects outside-injection-context access', () => {
    expect(() => bindings.injectUserContext(values => values.units)).toThrow()
  })
})
