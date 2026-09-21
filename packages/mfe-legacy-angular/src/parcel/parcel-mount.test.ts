import { beforeEach, describe, expect, it, vi } from 'vitest'

import { isMfeError } from '@company/mfe-core'

import { LegacyParcelMount } from './parcel-mount.ts'
import type { LegacyParcel, LegacyParcelConfig, LegacyParcelProps } from './single-spa-contract.ts'

/**
 * The whole single-spa surface this package uses; the real applications are not available
 * here, so this double encodes the contract they are expected to honour (§9).
 */
function createParcelDouble(
  behaviour: { readonly mountFails?: boolean; readonly unmountFails?: boolean } = {},
) {
  const lifecycleCalls: string[] = []

  const parcelConfig: LegacyParcelConfig = {
    bootstrap: [
      () => {
        lifecycleCalls.push('bootstrap')
        return Promise.resolve()
      },
    ],
    mount: [
      () => {
        lifecycleCalls.push('mount')
        return Promise.resolve()
      },
    ],
    unmount: [
      () => {
        lifecycleCalls.push('unmount')
        return Promise.resolve()
      },
    ],
  }

  const parcels: LegacyParcel[] = []
  const propsSeen: LegacyParcelProps[] = []

  const mountRootParcel = vi.fn((config: LegacyParcelConfig, props: LegacyParcelProps) => {
    propsSeen.push(props)

    const run = async (lifecycle: LegacyParcelConfig['bootstrap']): Promise<void> => {
      const fns = typeof lifecycle === 'function' ? [lifecycle] : lifecycle
      for (const fn of fns) await fn(props)
    }

    const parcel: LegacyParcel = {
      mountPromise: (async () => {
        await run(config.bootstrap)
        if (behaviour.mountFails) throw new Error('AssetTrackerModule failed to bootstrap')
        await run(config.mount)
      })(),
      unmount: vi.fn(async () => {
        await run(config.unmount)
        if (behaviour.unmountFails) throw new Error('ngOnDestroy threw')
      }),
    }

    parcels.push(parcel)
    return parcel
  })

  return { parcelConfig, mountRootParcel, parcels, propsSeen, lifecycleCalls }
}

function createMount(
  double: ReturnType<typeof createParcelDouble>,
  overrides: { readonly baseHref?: string } = {},
): LegacyParcelMount {
  return new LegacyParcelMount({
    id: 'asset-tracker',
    containerName: 'asset-tracker',
    parcelConfig: double.parcelConfig,
    mountRootParcel: double.mountRootParcel,
    domElement: document.createElement('div'),
    version: '4.7.1',
    ...overrides,
  })
}

let double: ReturnType<typeof createParcelDouble>

beforeEach(() => {
  double = createParcelDouble()
})

describe('LegacyParcelMount mounting', () => {
  it('runs the parcel lifecycle and reports the app mounted', async () => {
    const mount = createMount(double)

    await mount.mount()

    expect(double.mountRootParcel).toHaveBeenCalledTimes(1)
    expect(double.lifecycleCalls).toEqual(['bootstrap', 'mount'])
    expect(mount.status).toBe('mounted')
    expect(mount.isMounted).toBe(true)
  })

  it('hands the parcel the shell-owned element, the activity name and the base href', async () => {
    const mount = createMount(double, { baseHref: '/rigstream/' })

    await mount.mount()

    expect(double.propsSeen[0]).toMatchObject({
      name: 'asset-tracker',
      baseHref: '/rigstream/',
    })
    expect(double.propsSeen[0]?.domElement).toBeInstanceOf(HTMLElement)
  })

  it('omits the base href entirely for an app that provides its own', async () => {
    const mount = createMount(double)

    await mount.mount()

    expect(double.propsSeen[0] && 'baseHref' in double.propsSeen[0]).toBe(false)
  })

  it('notifies subscribers as the status changes', async () => {
    const mount = createMount(double)
    const seen: string[] = []
    mount.subscribe(() => seen.push(mount.getStatus()))

    await mount.mount()

    expect(seen).toEqual(['mounting', 'mounted'])
  })

  it('refuses a second mount while one is already live', async () => {
    const mount = createMount(double)
    await mount.mount()

    await expect(mount.mount()).rejects.toThrow(/already mounted/)
    expect(double.mountRootParcel).toHaveBeenCalledTimes(1)
  })
})

describe('LegacyParcelMount unmounting', () => {
  it('unmounts through the parcel handle and becomes remountable', async () => {
    const mount = createMount(double)
    await mount.mount()

    await mount.unmount()

    expect(double.parcels[0]?.unmount).toHaveBeenCalledTimes(1)
    expect(mount.status).toBe('idle')
    expect(mount.isMounted).toBe(false)
  })

  it('ignores an unmount when nothing is mounted', async () => {
    const mount = createMount(double)

    await mount.unmount()

    expect(double.mountRootParcel).not.toHaveBeenCalled()
    expect(mount.status).toBe('idle')
  })

  it('remounts by creating a fresh parcel rather than reusing the old one', async () => {
    const mount = createMount(double)
    await mount.mount()
    await mount.unmount()

    await mount.mount()

    expect(double.mountRootParcel).toHaveBeenCalledTimes(2)
    expect(double.parcels).toHaveLength(2)
    expect(double.parcels[0]).not.toBe(double.parcels[1])
    expect(double.lifecycleCalls).toEqual(['bootstrap', 'mount', 'unmount', 'bootstrap', 'mount'])
    expect(mount.status).toBe('mounted')
  })
})

describe('LegacyParcelMount failures', () => {
  it('reports a failed mount as a structured error and keeps no parcel', async () => {
    const failing = createParcelDouble({ mountFails: true })
    const mount = createMount(failing)

    const thrown = await mount.mount().catch((error: unknown) => error)

    expect(isMfeError(thrown)).toBe(true)
    expect(thrown).toMatchObject({
      code: 'mount/failure',
      id: 'asset-tracker',
      definitionVersion: '4.7.1',
    })
    expect((thrown as Error).message).toContain('AssetTrackerModule failed to bootstrap')
    expect(mount.status).toBe('error')
    expect(mount.error).toBe(thrown)
  })

  it('lets a failed mount be retried by mounting again', async () => {
    const failing = createParcelDouble({ mountFails: true })
    const mount = createMount(failing)
    await mount.mount().catch(() => undefined)

    await mount.mount().catch(() => undefined)

    expect(failing.mountRootParcel).toHaveBeenCalledTimes(2)
  })

  it('reports a failed unmount as a structured disposal error', async () => {
    const failing = createParcelDouble({ unmountFails: true })
    const mount = createMount(failing)
    await mount.mount()

    const thrown = await mount.unmount().catch((error: unknown) => error)

    expect(isMfeError(thrown)).toBe(true)
    expect(thrown).toMatchObject({ code: 'dispose/failure', id: 'asset-tracker' })
    expect((thrown as Error).message).toContain('ngOnDestroy threw')
    expect(mount.status).toBe('error')
  })

  it('does not reuse a parcel whose unmount threw', async () => {
    const failing = createParcelDouble({ unmountFails: true })
    const mount = createMount(failing)
    await mount.mount()
    await mount.unmount().catch(() => undefined)

    await mount.unmount().catch(() => undefined)

    expect(failing.parcels[0]?.unmount).toHaveBeenCalledTimes(1)
  })

  it('reports a parcel factory that throws before any lifecycle ran', async () => {
    const mount = new LegacyParcelMount({
      id: 'asset-tracker',
      containerName: 'asset-tracker',
      parcelConfig: double.parcelConfig,
      mountRootParcel: () => {
        throw new Error('mountRootParcel is not available')
      },
      domElement: document.createElement('div'),
    })

    const thrown = await mount.mount().catch((error: unknown) => error)

    expect(thrown).toMatchObject({ code: 'mount/failure' })
    expect((thrown as Error).message).toContain('mountRootParcel is not available')
    expect(mount.status).toBe('error')
  })
})

describe('LegacyParcelMount disposal', () => {
  it('unmounts the live parcel exactly once however often it is disposed', async () => {
    const mount = createMount(double)
    await mount.mount()

    await Promise.all([mount.dispose(), mount.dispose()])
    await mount.dispose()

    expect(double.parcels[0]?.unmount).toHaveBeenCalledTimes(1)
    expect(mount.status).toBe('disposed')
    expect(mount.isDisposed).toBe(true)
  })

  it('hands every caller the same teardown promise', async () => {
    const mount = createMount(double)
    await mount.mount()

    const first = mount.dispose()
    const second = mount.dispose()

    expect(first).toBe(second)
    await first
  })

  it('disposes cleanly when nothing was ever mounted', async () => {
    const mount = createMount(double)

    await mount.dispose()

    expect(double.mountRootParcel).not.toHaveBeenCalled()
    expect(mount.status).toBe('disposed')
  })

  it('stays disposed when the teardown itself fails, and never retries it', async () => {
    const failing = createParcelDouble({ unmountFails: true })
    const mount = createMount(failing)
    await mount.mount()

    const first = await mount.dispose().catch((error: unknown) => error)
    const second = await mount.dispose().catch((error: unknown) => error)

    expect(first).toMatchObject({ code: 'dispose/failure' })
    expect(second).toBe(first)
    expect(failing.parcels[0]?.unmount).toHaveBeenCalledTimes(1)
    expect(mount.status).toBe('disposed')
  })

  it('refuses to mount a disposed mount rather than resurrecting it', async () => {
    const mount = createMount(double)
    await mount.dispose()

    await expect(mount.mount()).rejects.toThrow(/Disposal is terminal/)
    expect(double.mountRootParcel).not.toHaveBeenCalled()
  })

  it('does not report success for a mount that was disposed mid-bootstrap', async () => {
    const mount = createMount(double)

    const mounting = mount.mount()
    const disposing = mount.dispose()
    const thrown = await mounting.catch((error: unknown) => error)
    await disposing

    expect(thrown).toMatchObject({ code: 'mount/failure' })
    expect((thrown as Error).message).toContain('disposed while the parcel was still bootstrapping')
    expect(mount.status).toBe('disposed')
  })
})
