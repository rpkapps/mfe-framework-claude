import { describe, expect, it, vi } from 'vitest'

import {
  allow,
  deny,
  isMfeError,
  type CommandPlacement,
  type CommandRegistration,
} from '@company/mfe-core'

import { CommandRegistry } from './command-registry.ts'
import { codesOf, recordingDiagnostics } from '../__tests__/harness.ts'

function registration(overrides: Partial<CommandRegistration> = {}): CommandRegistration {
  return {
    name: 'refresh',
    label: 'Refresh data',
    execute: () => undefined,
    ...overrides,
  }
}

describe('registration', () => {
  it('publishes a qualified entry for a registered command', () => {
    const registry = new CommandRegistry()

    registry.register('reports', 'mount-1', registration())

    expect(registry.size).toBe(1)
    expect(registry.getSnapshot()).toEqual([
      {
        id: 'reports:refresh',
        definitionId: 'reports',
        name: 'refresh',
        label: 'Refresh data',
        placements: ['command-palette'],
        decision: { allowed: true },
      },
    ])
  })

  it('notifies subscribers when a command is registered and again when it is removed', () => {
    const registry = new CommandRegistry()
    const subscriber = vi.fn()
    registry.subscribe(subscriber)

    const handle = registry.register('reports', 'mount-1', registration())
    expect(subscriber).toHaveBeenCalledTimes(1)

    handle.remove()
    expect(subscriber).toHaveBeenCalledTimes(2)
    expect(registry.getSnapshot()).toEqual([])
    expect(registry.size).toBe(0)
  })

  it('ignores a second remove from the same handle', () => {
    const registry = new CommandRegistry()
    const handle = registry.register('reports', 'mount-1', registration())
    const subscriber = vi.fn()
    registry.subscribe(subscriber)

    handle.remove()
    handle.remove()

    expect(subscriber).toHaveBeenCalledTimes(1)
  })

  it('ignores an update from a handle whose command was already removed', () => {
    const registry = new CommandRegistry()
    const handle = registry.register('reports', 'mount-1', registration())
    handle.remove()

    handle.update(registration({ label: 'Refresh everything' }))

    expect(registry.getSnapshot()).toEqual([])
  })

  it('clears every command owned by a mount in one call', () => {
    const registry = new CommandRegistry()
    registry.register('reports', 'mount-1', registration({ name: 'refresh' }))
    registry.register('reports', 'mount-1', registration({ name: 'export' }))
    registry.register('billing', 'mount-2', registration({ name: 'refresh' }))

    registry.removeMount('mount-1')

    expect(registry.getSnapshot().map(entry => entry.id)).toEqual(['billing:refresh'])
  })

  it('does not republish when clearing a mount that owns nothing', () => {
    const registry = new CommandRegistry()
    registry.register('reports', 'mount-1', registration())
    const before = registry.getSnapshot()
    const subscriber = vi.fn()
    registry.subscribe(subscriber)

    registry.removeMount('mount-unknown')

    expect(subscriber).not.toHaveBeenCalled()
    expect(registry.getSnapshot()).toBe(before)
  })
})

describe('duplicate names', () => {
  it('rejects a second registration of the same name inside one mount', () => {
    const registry = new CommandRegistry()
    registry.register('reports', 'mount-1', registration({ name: 'refresh' }))

    expect(() =>
      registry.register('reports', 'mount-1', registration({ name: 'refresh' })),
    ).toThrow(/one registration per command name within a mount/)

    expect(registry.size).toBe(1)
  })

  it('reports a duplicate name with the duplicate-name code and a rename instruction', () => {
    const registry = new CommandRegistry()
    registry.register('reports', 'mount-1', registration())

    try {
      registry.register('reports', 'mount-1', registration())
      expect.unreachable('the duplicate registration should have thrown')
    } catch (error) {
      expect(isMfeError(error)).toBe(true)
      if (!isMfeError(error)) return
      expect(error.code).toBe('command/duplicate-name')
      expect(error.id).toBe('reports')
      expect(error.message).toContain('Rename one of the commands')
    }
  })

  it('accepts the same local name in a different mount and qualifies both distinctly', () => {
    const registry = new CommandRegistry()
    registry.register('reports', 'mount-1', registration({ name: 'refresh' }))
    registry.register('billing', 'mount-2', registration({ name: 'refresh' }))

    expect(registry.size).toBe(2)
    expect(registry.getSnapshot().map(entry => entry.id)).toEqual([
      'reports:refresh',
      'billing:refresh',
    ])
  })
})

describe('update performance contract', () => {
  it('does not republish when only the execute and canExecute closures changed', () => {
    // a command whose visible state (label, placements, decision) is
    // stable across renders, but whose callbacks are new closures each time.
    const registry = new CommandRegistry()
    const handle = registry.register(
      'reports',
      'mount-1',
      registration({ execute: () => undefined, canExecute: () => allow() }),
    )
    const before = registry.getSnapshot()
    const subscriber = vi.fn()
    registry.subscribe(subscriber)

    handle.update(registration({ execute: () => undefined, canExecute: () => allow() }))

    // the palette's snapshot is untouched, so nothing re-renders.
    expect(registry.getSnapshot()).toBe(before)
    expect(subscriber).not.toHaveBeenCalled()
  })

  it('republishes when the label actually changed', () => {
    const registry = new CommandRegistry()
    const handle = registry.register('reports', 'mount-1', registration({ label: 'Refresh' }))
    const before = registry.getSnapshot()
    const subscriber = vi.fn()
    registry.subscribe(subscriber)

    handle.update(registration({ label: 'Refresh report data' }))

    expect(registry.getSnapshot()).not.toBe(before)
    expect(registry.getSnapshot()[0]?.label).toBe('Refresh report data')
    expect(subscriber).toHaveBeenCalledTimes(1)
  })

  it('republishes when the decision flipped from allowed to denied', () => {
    const registry = new CommandRegistry()
    const handle = registry.register('reports', 'mount-1', registration({ canExecute: allow }))
    const subscriber = vi.fn()
    registry.subscribe(subscriber)

    handle.update(registration({ canExecute: () => deny('Pick a report first.') }))

    expect(registry.getSnapshot()[0]?.decision).toEqual({
      allowed: false,
      reason: 'Pick a report first.',
    })
    expect(subscriber).toHaveBeenCalledTimes(1)
  })

  it('does not re-evaluate another command while one command updates', () => {
    const registry = new CommandRegistry()
    const refreshCanExecute = vi.fn(allow)
    const exportCanExecute = vi.fn(allow)
    const refresh = registry.register(
      'reports',
      'mount-1',
      registration({ name: 'refresh', canExecute: refreshCanExecute }),
    )
    registry.register(
      'reports',
      'mount-1',
      registration({ name: 'export', canExecute: exportCanExecute }),
    )
    refreshCanExecute.mockClear()
    exportCanExecute.mockClear()

    refresh.update(registration({ name: 'refresh', canExecute: refreshCanExecute }))

    // the untouched command's availability check never ran.
    expect(refreshCanExecute).toHaveBeenCalledTimes(1)
    expect(exportCanExecute).toHaveBeenCalledTimes(0)
  })

  it('re-evaluates every command when the palette opens', () => {
    const registry = new CommandRegistry()
    let hasSelection = false
    const refreshCanExecute = vi.fn(() =>
      hasSelection ? allow() : deny('Select a row to refresh.'),
    )
    const exportCanExecute = vi.fn(allow)
    registry.register(
      'reports',
      'mount-1',
      registration({ name: 'refresh', canExecute: refreshCanExecute }),
    )
    registry.register(
      'reports',
      'mount-1',
      registration({ name: 'export', canExecute: exportCanExecute }),
    )
    refreshCanExecute.mockClear()
    exportCanExecute.mockClear()
    const subscriber = vi.fn()
    registry.subscribe(subscriber)

    hasSelection = true
    registry.evaluateAll()

    expect(refreshCanExecute).toHaveBeenCalledTimes(1)
    expect(exportCanExecute).toHaveBeenCalledTimes(1)
    expect(registry.getSnapshot()[0]?.decision).toEqual({ allowed: true })
    expect(subscriber).toHaveBeenCalledTimes(1)
  })

  it('does not republish when re-evaluation found nothing different', () => {
    const registry = new CommandRegistry()
    registry.register('reports', 'mount-1', registration({ canExecute: allow }))
    const before = registry.getSnapshot()
    const subscriber = vi.fn()
    registry.subscribe(subscriber)

    registry.evaluateAll()

    expect(registry.getSnapshot()).toBe(before)
    expect(subscriber).not.toHaveBeenCalled()
  })
})

describe('renaming through update', () => {
  it('replaces the registration under the new qualified id', () => {
    const registry = new CommandRegistry()
    const handle = registry.register('reports', 'mount-1', registration({ name: 'refresh' }))

    handle.update(registration({ name: 'reload', label: 'Reload data' }))

    expect(registry.size).toBe(1)
    expect(registry.getSnapshot().map(entry => entry.id)).toEqual(['reports:reload'])
  })

  it('rejects a rename that would collide with another command in the same mount', () => {
    const registry = new CommandRegistry()
    const refresh = registry.register('reports', 'mount-1', registration({ name: 'refresh' }))
    registry.register('reports', 'mount-1', registration({ name: 'export' }))

    expect(() => refresh.update(registration({ name: 'export' }))).toThrow(
      /one registration per command name within a mount/,
    )
    expect(registry.getSnapshot().map(entry => entry.id)).toEqual([
      'reports:refresh',
      'reports:export',
    ])
  })

  it('re-validates the new name, so a rename cannot smuggle in an illegal one', () => {
    const registry = new CommandRegistry()
    const handle = registry.register('reports', 'mount-1', registration({ name: 'refresh' }))

    expect(() => handle.update(registration({ name: 'refresh:now' }))).toThrow(
      /letters, digits and hyphens/,
    )
    expect(registry.getSnapshot().map(entry => entry.id)).toEqual(['reports:refresh'])
  })

  it('makes the old qualified id unavailable after a rename', async () => {
    const registry = new CommandRegistry()
    const handle = registry.register('reports', 'mount-1', registration({ name: 'refresh' }))

    handle.update(registration({ name: 'reload' }))

    await expect(registry.execute('reports:refresh')).resolves.toMatchObject({
      status: 'unavailable',
    })
    await expect(registry.execute('reports:reload')).resolves.toEqual({ status: 'executed' })
  })
})

describe('registration validation', () => {
  it.each([
    ['an empty name', ''],
    ['a name starting with a digit', '1refresh'],
    ['a name containing the qualifier separator', 'reports:refresh'],
    ['a name containing a space', 'refresh now'],
    ['a name containing an underscore', 'refresh_now'],
  ])('rejects %s', (_label, name) => {
    const registry = new CommandRegistry()

    expect(() => registry.register('reports', 'mount-1', registration({ name }))).toThrow(
      /letters, digits and hyphens starting with a letter/,
    )
  })

  it('accepts hyphenated names', () => {
    const registry = new CommandRegistry()

    registry.register('reports', 'mount-1', registration({ name: 'refresh-all' }))

    expect(registry.getSnapshot().map(entry => entry.id)).toEqual(['reports:refresh-all'])
  })

  it('rejects an empty label because the palette has nothing to render', () => {
    const registry = new CommandRegistry()

    expect(() => registry.register('reports', 'mount-1', registration({ label: '' }))).toThrow(
      /human-readable label/,
    )
  })

  it('rejects a placement that is not standardized', () => {
    const registry = new CommandRegistry()

    expect(() =>
      registry.register(
        'reports',
        'mount-1',
        registration({ placements: ['toolbar' as CommandPlacement] }),
      ),
    ).toThrow(/standardized placement \(command-palette\)/)
  })

  it('accepts an explicit command-palette placement', () => {
    const registry = new CommandRegistry()

    registry.register('reports', 'mount-1', registration({ placements: ['command-palette'] }))

    expect(registry.getSnapshot()[0]?.placements).toEqual(['command-palette'])
  })
})

describe('execution', () => {
  it('runs a command whose availability check allows it', async () => {
    const execute = vi.fn()
    const registry = new CommandRegistry()
    registry.register('reports', 'mount-1', registration({ execute, canExecute: allow }))

    await expect(registry.execute('reports:refresh')).resolves.toEqual({ status: 'executed' })
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('awaits an asynchronous command before reporting success', async () => {
    let finished = false
    const registry = new CommandRegistry()
    registry.register(
      'reports',
      'mount-1',
      registration({
        execute: async () => {
          await Promise.resolve()
          finished = true
        },
      }),
    )

    await registry.execute('reports:refresh')

    expect(finished).toBe(true)
  })

  it('re-checks the latest committed availability rather than the published entry', async () => {
    // registered while allowed, then the mount commits a denial.
    const execute = vi.fn()
    const notifyDenial = vi.fn()
    const registry = new CommandRegistry({ notifyDenial })
    const handle = registry.register(
      'reports',
      'mount-1',
      registration({ execute, canExecute: allow }),
    )
    let allowed = true
    handle.update(
      registration({
        execute,
        canExecute: () => (allowed ? allow() : deny('Select a report before refreshing.')),
      }),
    )
    allowed = false

    const result = await registry.execute('reports:refresh')

    expect(result).toEqual({ status: 'denied', reason: 'Select a report before refreshing.' })
    expect(execute).not.toHaveBeenCalled()
    expect(notifyDenial).toHaveBeenCalledWith({
      commandId: 'reports:refresh',
      label: 'Refresh data',
      reason: 'Select a report before refreshing.',
    })
  })

  it('refreshes the published entry so the palette shows the denial', async () => {
    const registry = new CommandRegistry()
    let allowed = true
    registry.register(
      'reports',
      'mount-1',
      registration({ canExecute: () => (allowed ? allow() : deny('Not now.')) }),
    )
    expect(registry.getSnapshot()[0]?.decision).toEqual({ allowed: true })
    const subscriber = vi.fn()
    registry.subscribe(subscriber)

    allowed = false
    await registry.execute('reports:refresh')

    expect(registry.getSnapshot()[0]?.decision).toEqual({ allowed: false, reason: 'Not now.' })
    expect(subscriber).toHaveBeenCalledTimes(1)
  })

  it('reports an unknown command as unavailable and diagnoses it', async () => {
    const { hub, records } = recordingDiagnostics()
    const registry = new CommandRegistry({ diagnostics: hub })

    const result = await registry.execute('reports:refresh')

    expect(result.status).toBe('unavailable')
    expect(records).toHaveLength(1)
    expect(records[0]?.severity).toBe('warning')
    expect(records[0]?.error.message).toContain('unloaded or disposed')
  })

  it('reports a command from a disposed mount as unavailable', async () => {
    const { hub, records } = recordingDiagnostics()
    const registry = new CommandRegistry({ diagnostics: hub })
    registry.register('reports', 'mount-1', registration())
    registry.removeMount('mount-1')

    const result = await registry.execute('reports:refresh')

    expect(result.status).toBe('unavailable')
    expect(codesOf(records)).toEqual(['command/duplicate-name'])
  })

  it('denies and diagnoses when the availability check itself throws', async () => {
    const { hub, records } = recordingDiagnostics()
    const execute = vi.fn()
    const notifyDenial = vi.fn()
    const registry = new CommandRegistry({ diagnostics: hub, notifyDenial })
    registry.register(
      'reports',
      'mount-1',
      registration({
        execute,
        canExecute: () => {
          throw new Error('read of undefined selection')
        },
      }),
    )
    records.length = 0

    const result = await registry.execute('reports:refresh')

    // an unknown precondition denies rather than running the command.
    expect(result).toEqual({
      status: 'denied',
      reason: 'This command is unavailable because its availability check failed.',
    })
    expect(execute).not.toHaveBeenCalled()
    expect(notifyDenial).toHaveBeenCalledTimes(1)
    expect(records.length).toBeGreaterThan(0)
    expect(records[0]?.error.message).toContain('pure synchronous read')
  })

  it('returns a structured failure when the command throws', async () => {
    const { hub, records } = recordingDiagnostics()
    const registry = new CommandRegistry({ diagnostics: hub })
    registry.register(
      'reports',
      'mount-1',
      registration({
        execute: () => {
          throw new Error('export service is down')
        },
      }),
    )

    const result = await registry.execute('reports:refresh')

    expect(result.status).toBe('failed')
    if (result.status !== 'failed') return
    expect(result.error.code).toBe('mount/failure')
    expect(result.error.id).toBe('reports')
    expect(result.error.cause).toBeInstanceOf(Error)
    expect(result.error.message).toContain('export service is down')
    expect(records).toHaveLength(1)
    expect(records[0]?.error).toBe(result.error)
  })

  it('returns a structured failure when the command rejects', async () => {
    const { hub, records } = recordingDiagnostics()
    const registry = new CommandRegistry({ diagnostics: hub })
    registry.register(
      'reports',
      'mount-1',
      registration({ execute: () => Promise.reject(new Error('network down')) }),
    )

    const result = await registry.execute('reports:refresh')

    expect(result.status).toBe('failed')
    expect(codesOf(records)).toEqual(['mount/failure'])
  })

  it('structures a command that threw a non-Error value', async () => {
    const registry = new CommandRegistry()
    registry.register(
      'reports',
      'mount-1',
      registration({
        execute: () => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error -- a command that throws a non-Error is exactly what this test covers, so the value has to stay a bare string
          throw 'just a string'
        },
      }),
    )

    const result = await registry.execute('reports:refresh')

    expect(result.status).toBe('failed')
    if (result.status !== 'failed') return
    expect(isMfeError(result.error)).toBe(true)
    expect(result.error.message).toContain('just a string')
  })
})

describe('disposal', () => {
  it('drops every command and stops notifying subscribers', async () => {
    const registry = new CommandRegistry()
    registry.register('reports', 'mount-1', registration())
    const subscriber = vi.fn()
    registry.subscribe(subscriber)

    registry.dispose()

    expect(registry.size).toBe(0)
    await expect(registry.execute('reports:refresh')).resolves.toMatchObject({
      status: 'unavailable',
    })
    expect(subscriber).not.toHaveBeenCalled()
  })
})
