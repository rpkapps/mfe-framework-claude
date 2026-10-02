import { afterEach, describe, expect, it } from 'vitest'

import {
  createMfeError,
  DEFINITION_BRAND,
  type BrandedDefinition,
  type MfeAdapter,
  type RegistryEntry,
} from '@company/mfe-core'

import { createMemoryRuntime, type MemoryRuntime } from '../testing/memory-runtime.ts'

const created: MemoryRuntime[] = []
afterEach(() => {
  for (const handle of created.splice(0)) handle.dispose()
})

function memory(options: Parameters<typeof createMemoryRuntime>[0] = {}): MemoryRuntime {
  const runtime = createMemoryRuntime(options)
  created.push(runtime)
  return runtime
}

const entry: RegistryEntry = {
  id: 'reports',
  definitionKind: 'app',
  adapter: 'test',
  version: '2.1.0',
  requiresRuntime: '>=1.1.0 <2.0.0',
  manifestUrl: 'https://cdn.example.test/reports?token=secret',
  build: { hash: 'abc123', time: '2026-10-02T00:00:00Z' },
  overridden: true,
  contract: { inputSchema: { secret: 'private contract' } },
}

const adapter: MfeAdapter = {
  kind: 'test',
  detect: () => true,
  parse: raw => {
    if (raw === entry) return entry
    throw createMfeError({
      code: 'registry/invalid-entry',
      id: 'broken',
      operation: 'parse entry',
      observed: 'missing kind',
      repair: 'Rebuild the container.',
    })
  },
  is: (candidate): candidate is RegistryEntry => candidate.adapter === 'test',
}

describe('runtime diagnostic snapshots', () => {
  it('captures an empty runtime without loading anything', () => {
    const { runtime } = memory()
    const before = Date.now()

    const snapshot = runtime.getSnapshot()

    expect(snapshot.apiVersion).toBe(runtime.apiVersion)
    expect(snapshot.capturedAt).toBeGreaterThanOrEqual(before)
    expect(snapshot.capturedAt).toBeLessThanOrEqual(Date.now())
    expect(snapshot.mounts).toEqual([])
    expect(snapshot.registry).toEqual({ entries: [], rejected: [] })
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot)
  })

  it('copies published builds and rejections without raw sources, URLs or services', () => {
    const { runtime } = memory({
      registryEntries: [
        entry,
        { id: 'broken', requiresRuntime: '>=1.1.0 <2.0.0', token: 'secret' },
      ],
      adapters: [adapter],
    })

    const snapshot = runtime.getSnapshot()

    expect(snapshot.registry.entries).toEqual([
      {
        id: 'reports',
        kind: 'app',
        adapter: 'test',
        version: '2.1.0',
        build: { hash: 'abc123', time: '2026-10-02T00:00:00Z' },
        overridden: true,
      },
    ])
    expect(snapshot.registry.rejected).toEqual([
      {
        id: 'broken',
        reason: runtime.registry.rejected[0]?.reason,
        errorCode: 'registry/invalid-entry',
      },
    ])
    const serialized = JSON.stringify(snapshot)
    expect(serialized).not.toContain('secret')
    expect(serialized).not.toContain('private contract')
    expect(serialized).not.toContain('test-user')
    expect(JSON.parse(serialized)).toEqual(snapshot)

    const build = snapshot.registry.entries[0]?.build
    if (build === undefined) throw new Error('expected a copied build')
    Reflect.set(build, 'hash', 'modified')
    Reflect.set(snapshot.registry.rejected[0] ?? {}, 'reason', 'modified')
    expect(runtime.getSnapshot().registry.entries[0]?.build?.hash).toBe('abc123')
    expect(runtime.getSnapshot().registry.rejected[0]?.reason).not.toBe('modified')
  })

  it('keeps optional provenance absent rather than inventing versions or builds', () => {
    const definition: BrandedDefinition = {
      [DEFINITION_BRAND]: true,
      id: 'unversioned',
      kind: 'widget',
      framework: 'test',
      requiresRuntime: '>=1.1.0 <2.0.0',
    }
    const { runtime } = memory({ definitions: [definition] })
    expect(runtime.getSnapshot().registry.entries).toEqual([
      { id: 'unversioned', kind: 'widget', adapter: 'test', overridden: false },
    ])
  })
})
