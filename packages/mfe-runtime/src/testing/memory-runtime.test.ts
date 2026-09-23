/**
 * Every adapter's test environment stands on this runtime, so it has to behave like the one a
 * shell builds — registry, loader, session fencing — with nothing behind it but memory, and no
 * state shared between two of them.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  createMfeError,
  DEFINITION_BRAND,
  type BrandedDefinition,
  type DefinitionFramework,
  type DefinitionKind,
} from '@company/mfe-core'

import { createMemoryHostRuntime, type MemoryHostRuntime } from './memory-host-runtime.ts'

const created: MemoryHostRuntime[] = []

afterEach(() => {
  for (const memory of created.splice(0)) memory.dispose()
})

function memoryRuntime(
  options: Parameters<typeof createMemoryHostRuntime>[0] = {},
): MemoryHostRuntime {
  const memory = createMemoryHostRuntime(options)
  created.push(memory)
  return memory
}

function definition(
  id: string,
  kind: DefinitionKind,
  framework: DefinitionFramework,
  version?: string,
): BrandedDefinition {
  return {
    [DEFINITION_BRAND]: true,
    kind,
    id,
    framework,
    ...(version === undefined ? {} : { version }),
  }
}

const liveSignal = (): AbortSignal => new AbortController().signal

describe('createMemoryHostRuntime', () => {
  it('lists each definition under its own id, as the adapter that built it would', () => {
    const { runtime } = memoryRuntime({
      definitions: [
        definition('reports', 'app', 'react'),
        definition('alert-panel', 'widget', 'angular'),
      ],
    })

    expect(runtime.registry.rejected).toEqual([])
    expect(runtime.registry.entries.get('reports')).toMatchObject({
      definitionKind: 'app',
      adapter: 'react',
      container: 'reports',
    })
    expect(runtime.registry.entries.get('alert-panel')).toMatchObject({
      definitionKind: 'widget',
      adapter: 'angular',
      container: 'alert_panel',
    })
  })

  it('loads the definitions it was handed, with their identity', async () => {
    const panel = definition('alert-panel', 'widget', 'angular', '1.4.0')
    const { runtime } = memoryRuntime({ definitions: [panel] })
    const entry = runtime.registry.entries.get('alert-panel')
    if (!entry) throw new Error('expected the Widget to be registered')

    const loaded = await runtime.loader.load(entry, { signal: liveSignal() })

    expect(loaded.module).toBe(panel)
    expect(loaded.identity).toEqual({ id: 'alert-panel', kind: 'widget', version: '1.4.0' })
  })

  /** `null` is a signed-out page rather than a missing value, so it is not replaced. */
  it('starts signed in as a test user on the light theme, unless told otherwise', () => {
    const defaults = memoryRuntime()
    const dark = memoryRuntime({ shellState: { theme: 'dark', user: null } })

    expect(defaults.runtime.shellState.getSnapshot()).toMatchObject({
      user: { id: 'test-user' },
      groups: ['testers'],
      theme: 'light',
    })
    expect(dark.runtime.shellState.getSnapshot()).toMatchObject({
      user: null,
      groups: ['testers'],
      theme: 'dark',
    })
  })

  it('starts the navigation where it is told to', () => {
    const { runtime, navigation } = memoryRuntime({ initialEntries: ['/reports/a'] })

    expect(runtime.navigator.read().pathname).toBe('/reports/a')
    expect(navigation.read().pathname).toBe('/reports/a')
  })

  it('retires the storage session the way a shell does when the user changes', () => {
    const memory = memoryRuntime({ sessionGeneration: 'gen-1' })

    memory.setShellState({ user: { id: 'grace', name: 'Grace' } })

    expect(memory.runtime.storage.sessionGeneration).not.toBe('gen-1')
    expect(memory.runtime.storage.sessionGeneration).not.toBeNull()
  })

  it('records everything reported to the runtime, in order', () => {
    const { runtime, diagnostics } = memoryRuntime()
    const failure = (id: string) =>
      createMfeError({ code: 'mount/failure', id, operation: 'mount', repair: 'Retry.' })

    runtime.diagnostics.report(failure('first'))
    runtime.diagnostics.report(failure('second'), { severity: 'warning' })

    expect(diagnostics.map(diagnostic => diagnostic.error.id)).toEqual(['first', 'second'])
  })

  it('shares no storage with another runtime', () => {
    const first = memoryRuntime()
    const second = memoryRuntime()

    first.runtime.storage.storageFor('reports', 'local').key('density', z.string()).set('compact')

    expect(
      second.runtime.storage.storageFor('reports', 'local').key('density', z.string()).get(),
    ).toBeNull()
    expect(first.storageAreas.local.length).toBe(1)
    expect(second.storageAreas.local.length).toBe(0)
  })

  it('stops following the shell state once disposed', () => {
    const memory = createMemoryHostRuntime({ sessionGeneration: 'gen-1' })

    memory.dispose()
    memory.setShellState({ user: { id: 'grace', name: 'Grace' } })

    expect(memory.runtime.storage.sessionGeneration).toBe('gen-1')
  })
})
