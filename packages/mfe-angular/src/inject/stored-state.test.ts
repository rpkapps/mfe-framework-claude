import {
  Component,
  computed,
  createEnvironmentInjector,
  runInInjectionContext,
} from '@angular/core'
import {
  HOST_SCOPE,
  storedKey,
  type StoredRow,
  type StoredValue,
  type UserStorageAdapter,
  type UserStorageState,
} from '@company/mfe-core'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { createWidget } from '../definition.ts'
import {
  createHostApplication,
  createMemoryUserStorage,
  createMfeTestEnvironment,
  mountWidget,
} from '../testing/index.ts'
import { injectStoredState } from './stored-state.ts'

const densityKey = storedKey('density', z.enum(['comfortable', 'compact']).default('comfortable'))
const instanceDensityKey = storedKey(
  'density',
  z.enum(['comfortable', 'compact']).default('comfortable'),
  { perInstance: true },
)
const unitsSchema = z.enum(['metric', 'imperial']).default('metric')
const unitsKey = storedKey('units', unitsSchema, { storage: 'user' })

@Component({ selector: 'test-empty', template: '' })
class EmptyComponent {}

const tableWidget = createWidget({
  id: 'orders-table',
  inputSchema: z.object({}),
  outputSchema: z.object({}),
  component: EmptyComponent,
})

function injectDensity() {
  return injectStoredState(densityKey)
}

/** Lets the memory backend's load, and any save it answers at once, settle. */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve()
}

interface PendingSave {
  readonly owner: string
  readonly key: string
  readonly value: StoredValue | null
  resolve(): void
  reject(error: unknown): void
}

/** A backend whose saves wait until the test settles them, one by one. */
function controllableAdapter(initial: UserStorageState = {}): UserStorageAdapter & {
  readonly pending: PendingSave[]
} {
  const pending: PendingSave[] = []
  let revision = 1
  return {
    pending,
    load: () => Promise.resolve(initial),
    save: (owner, key, value) =>
      new Promise<StoredRow | null>((resolve, reject) => {
        pending.push({
          owner,
          key,
          value,
          resolve: () => {
            revision += 1
            resolve(value === null ? null : { ...value, revision })
          },
          reject,
        })
      }),
  }
}

describe('injectStoredState', () => {
  it('stores under the definition inside a mount and under the host scope outside one', async () => {
    const environment = createMfeTestEnvironment({ definitions: [tableWidget] })
    const widget = await mountWidget(tableWidget, { environment })
    const appRef = await createHostApplication(environment)

    const mounted = runInInjectionContext(widget.injector, injectDensity)
    const chrome = runInInjectionContext(appRef.injector, injectDensity)
    await mounted.set('compact')

    expect(mounted.value()).toBe('compact')
    expect(mounted.status()).toBe('ready')
    expect(chrome.value()).toBe('comfortable')
    expect(Object.keys(environment.storageAreas.local.snapshot())).toEqual(['orders-table:density'])

    await chrome.set(previous => (previous === 'compact' ? 'comfortable' : 'compact'))
    expect(chrome.value()).toBe('compact')
    expect(Object.keys(environment.storageAreas.local.snapshot()).sort()).toEqual([
      `${HOST_SCOPE}:density`,
      'orders-table:density',
    ])
    environment.dispose()
  })

  it('follows writes made through another consumer of the same key, and resets', async () => {
    const environment = createMfeTestEnvironment()
    const appRef = await createHostApplication(environment)
    const state = runInInjectionContext(appRef.injector, injectDensity)
    const other = environment.runtime.storage.forCaller({ owner: HOST_SCOPE })

    await other.set(densityKey, 'compact')
    expect(state.value()).toBe('compact')

    await state.reset()
    expect(state.value()).toBe('comfortable')
    expect(other.peek(densityKey)).toBe('comfortable')
    expect(environment.storageAreas.local.snapshot()).toEqual({})
    environment.dispose()
  })

  it('isolates duplicate instances and restores a stable widget ID after remounting', async () => {
    const environment = createMfeTestEnvironment({ definitions: [tableWidget] })
    const north = await mountWidget(tableWidget, { environment, instanceId: 'north' })
    const south = await mountWidget(tableWidget, { environment, instanceId: 'south' })
    const injectInstance = () => injectStoredState(instanceDensityKey)
    const first = runInInjectionContext(north.injector, injectInstance)
    const other = runInInjectionContext(south.injector, injectInstance)
    await first.set('compact')
    expect(first.value()).toBe('compact')
    expect(other.value()).toBe('comfortable')
    await north.dispose()

    const fresh = await mountWidget(tableWidget, { environment, instanceId: 'north' })
    expect(runInInjectionContext(fresh.injector, injectInstance).value()).toBe('compact')
    await fresh.dispose()
    await south.dispose()
    environment.dispose()
  })

  it('rejects instance state without a stable ID instead of using definition or host storage', async () => {
    const environment = createMfeTestEnvironment({ definitions: [tableWidget] })
    const widget = await mountWidget(tableWidget, { environment })
    const appRef = await createHostApplication(environment)
    const injectInstance = () => injectStoredState(instanceDensityKey)
    expect(() => runInInjectionContext(widget.injector, injectInstance)).toThrow(/instanceId/)
    expect(() => runInInjectionContext(appRef.injector, injectInstance)).toThrow(/instanceId/)
    expect(environment.storageAreas.local.snapshot()).toEqual({})
    environment.dispose()
  })

  it('releases its binding when the injector that created it is destroyed', async () => {
    const environment = createMfeTestEnvironment()
    const appRef = await createHostApplication(environment)
    const { browser } = environment.runtime.storage
    const held = browser.bindHost({
      name: 'density',
      schema: densityKey.schema,
      defaultValue: 'comfortable' as const,
    })
    const chrome = createEnvironmentInjector([], appRef.injector)
    runInInjectionContext(chrome, injectDensity)

    chrome.destroy()
    // If the injector released, `held` is now the last binding and dropping it drops the entry,
    // so a different default binds instead of being rejected as a conflicting declaration.
    held.release()

    expect(() =>
      browser
        .bindHost({ name: 'density', schema: densityKey.schema, defaultValue: 'compact' as const })
        .release(),
    ).not.toThrow()
    environment.dispose()
  })

  it('reads the default with an error status, rather than throwing, when the stored value is unreadable', async () => {
    const environment = createMfeTestEnvironment()
    environment.storageAreas.local.setItem(
      `${HOST_SCOPE}:density`,
      JSON.stringify({ v: 1, d: 'sparse' }),
    )
    const appRef = await createHostApplication(environment)

    const state = runInInjectionContext(appRef.injector, injectDensity)

    expect(state.value()).toBe('comfortable')
    expect(state.status()).toBe('error')
    expect(state.error()?.code).toBe('storage/invalid-value')

    await state.set('compact')
    expect(state.status()).toBe('ready')
    expect(state.error()).toBeUndefined()
    expect(state.value()).toBe('compact')
    environment.dispose()
  })

  it('seeds values from the same options React’s test environment takes', async () => {
    const environment = createMfeTestEnvironment({
      definitions: [tableWidget],
      instanceId: 'north',
      storage: [
        [densityKey, 'compact'],
        [instanceDensityKey, 'compact'],
      ],
    })
    const north = await mountWidget(tableWidget, { environment, instanceId: 'north' })
    const south = await mountWidget(tableWidget, { environment, instanceId: 'south' })

    expect(runInInjectionContext(north.injector, injectDensity).value()).toBe('compact')
    expect(
      runInInjectionContext(north.injector, () => injectStoredState(instanceDensityKey)).value(),
    ).toBe('compact')
    expect(
      runInInjectionContext(south.injector, () => injectStoredState(instanceDensityKey)).value(),
    ).toBe('comfortable')
    environment.dispose()
  })
})

describe('injectStoredState on a user key', () => {
  it('goes from loading, with the default, to ready with the stored value', async () => {
    const backend = createMemoryUserStorage({
      [HOST_SCOPE]: { units: { v: 1, d: 'imperial', revision: 1 } },
    })
    let finishLoading: () => void = () => undefined
    const loaded = new Promise<void>(resolve => {
      finishLoading = resolve
    })
    const environment = createMfeTestEnvironment({
      userStorage: { ...backend, load: signal => loaded.then(() => backend.load(signal)) },
    })
    const appRef = await createHostApplication(environment)
    const units = runInInjectionContext(appRef.injector, () => injectStoredState(unitsKey))

    expect(units.status()).toBe('loading')
    expect(units.value()).toBe('metric')
    await expect(units.set('imperial')).rejects.toMatchObject({ code: 'storage/not-ready' })

    finishLoading()
    await environment.runtime.storage.whenLoaded()
    expect(units.status()).toBe('ready')
    expect(units.value()).toBe('imperial')
    expect(units.error()).toBeUndefined()
    environment.dispose()
  })

  it('shows saving until the backend stores the value, then resolves set', async () => {
    const adapter = controllableAdapter()
    const environment = createMfeTestEnvironment({ userStorage: adapter })
    await environment.runtime.storage.whenLoaded()
    const appRef = await createHostApplication(environment)
    const units = runInInjectionContext(appRef.injector, () => injectStoredState(unitsKey))

    let settled = false
    const saving = units.set('imperial').then(() => {
      settled = true
    })
    await flush()

    expect(units.status()).toBe('saving')
    expect(units.value()).toBe('imperial')
    expect(adapter.pending[0]).toMatchObject({
      owner: HOST_SCOPE,
      key: 'units',
      value: { v: 1, d: 'imperial' },
    })
    expect(settled).toBe(false)

    adapter.pending[0]?.resolve()
    await saving
    expect(units.status()).toBe('ready')
    expect(units.value()).toBe('imperial')
    environment.dispose()
  })

  it('rolls back a failed save with an error, and sends it again on retry', async () => {
    const adapter = controllableAdapter()
    const environment = createMfeTestEnvironment({ userStorage: adapter })
    await environment.runtime.storage.whenLoaded()
    const appRef = await createHostApplication(environment)
    const units = runInInjectionContext(appRef.injector, () => injectStoredState(unitsKey))

    const saving = units.set('imperial')
    await flush()
    adapter.pending[0]?.reject(new Error('backend down'))
    await expect(saving).rejects.toMatchObject({ code: 'storage/persistence-failed' })

    expect(units.value()).toBe('metric')
    expect(units.status()).toBe('error')
    expect(units.error()?.code).toBe('storage/persistence-failed')

    const retrying = units.retry()
    await flush()
    expect(units.status()).toBe('saving')
    expect(adapter.pending[1]?.value).toEqual({ v: 1, d: 'imperial' })
    adapter.pending[1]?.resolve()
    await retrying

    expect(units.status()).toBe('ready')
    expect(units.value()).toBe('imperial')
    expect(units.error()).toBeUndefined()
    environment.dispose()
  })

  it('removes the stored row on reset', async () => {
    const environment = createMfeTestEnvironment({ storage: [[unitsKey, 'imperial']] })
    await environment.runtime.storage.whenLoaded()
    const appRef = await createHostApplication(environment)
    const units = runInInjectionContext(appRef.injector, () => injectStoredState(unitsKey))

    await units.reset()

    expect(units.value()).toBe('metric')
    expect(environment.userStorage?.saves).toEqual([
      { owner: HOST_SCOPE, key: 'units', value: null },
    ])
    environment.dispose()
  })

  it('narrows the value with select, which changes only when the selected part does', async () => {
    const filtersKey = storedKey(
      'filters',
      z
        .object({ well: z.string().nullable(), status: z.enum(['open', 'closed']) })
        .default({ well: null, status: 'open' }),
    )
    const environment = createMfeTestEnvironment()
    const appRef = await createHostApplication(environment)
    const well = runInInjectionContext(appRef.injector, () =>
      injectStoredState(filtersKey, { select: filters => filters.well }),
    )
    let reads = 0
    const shown = computed(() => {
      reads += 1
      return well.value()
    })

    expect(shown()).toBeNull()
    expect(reads).toBe(1)

    await well.set(previous => ({ ...previous, status: 'closed' }))
    expect(shown()).toBeNull()
    expect(reads).toBe(1)

    await well.set(previous => ({ ...previous, well: 'A-7' }))
    expect(shown()).toBe('A-7')
    expect(reads).toBe(2)
    environment.dispose()
  })
})

describe('injectStoredState on a read-only key', () => {
  const labUnits = storedKey.from('lab', 'units', unitsSchema, { storage: 'user' })

  it('reads the owner’s value and has no setter', async () => {
    const environment = createMfeTestEnvironment({ storage: [[labUnits, 'imperial']] })
    await environment.runtime.storage.whenLoaded()
    const appRef = await createHostApplication(environment)

    const units = runInInjectionContext(appRef.injector, () => injectStoredState(labUnits))

    expect(units.value()).toBe('imperial')
    expect(units.status()).toBe('ready')
    // @ts-expect-error: a key declared with storedKey.from has no setter
    expect(units.set).toBeUndefined()
    // @ts-expect-error: nor does it have a reset
    expect(units.reset).toBeUndefined()
    environment.dispose()
  })

  it('reads its own default with an error when the owner’s value does not match its schema', async () => {
    const strict = storedKey.from('lab', 'units', z.enum(['si']).default('si'), { storage: 'user' })
    const environment = createMfeTestEnvironment({
      userStorage: createMemoryUserStorage({
        lab: { units: { v: 1, d: 'imperial', revision: 1 } },
      }),
    })
    await environment.runtime.storage.whenLoaded()
    const appRef = await createHostApplication(environment)

    const units = runInInjectionContext(appRef.injector, () => injectStoredState(strict))

    expect(units.value()).toBe('si')
    expect(units.status()).toBe('error')
    expect(units.error()?.code).toBe('storage/invalid-value')
    environment.dispose()
  })
})
